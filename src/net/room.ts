// Multiplayer glue on top of Playroom Kit.
//
// Secrecy model: Playroom shared state is visible to every client, so the secret word is
// never written to it. It lives only in the chooser's browser (memory + localStorage so a
// reload, or reopening the invite link, survives). Guessers send guesses to everyone via RPC;
// only the chooser's client acts on them and publishes the masked result. The host only starts/advances rounds.
import {
  RPC,
  getParticipants,
  getRoomCode,
  getState,
  insertCoin,
  isHost,
  myPlayer,
  onPlayerJoin,
  setState,
  waitForState,
  type PlayerState,
} from 'playroomkit';
import {
  applyLetter,
  applyPass,
  applyWordGuess,
  beginGuessing,
  canGuess,
  DEFAULT_DIFFICULTY,
  isDifficulty,
  MAX_WORD_LENGTH,
  newRound,
  nextInOrder,
  syncTurn,
  type Difficulty,
  type GuessResult,
  type RoundState,
} from '../logic/hangman';
import { skipLobby } from '../dev';
import { adoptSavedIdentity, holdPlayer, loadSelf, saveSelf, type Profile, type Self } from './identity';
import { GAME_NIGHT_MS, readObject, write } from './storage';

export interface Player {
  id: string;
  name: string;
  color: string;
  /** Avatar image URL (usually a data: URL) from the Playroom profile; may be empty. */
  photo: string;
}

export const MAX_NAME_LENGTH = 16;

type GuessPayload = { kind: 'letter' | 'word' | 'pass'; value: string };

const players = new Map<string, PlayerState>();
/** Everyone seen this session, in join order, including players who have since left. */
const joinOrder: string[] = [];
/** Last known display names, so a player who dropped out can still be named. */
const knownNames = new Map<string, string>();
/** Profiles of everyone seen in the game this session, so the host can put back what a reconnect loses. */
const knownProfiles = new Map<string, Profile>();
/** word is null when this device has no copy of the round's word (cached so storage isn't re-read). */
let secret: { roundId: number; word: string | null; forgotten: boolean } | null = null;

/**
 * How long the word picker may be gone before the host ends the round. Long enough for a phone that
 * went to sleep to wake up and reconnect; the host can still end a stuck round sooner with End round.
 */
const CHOOSER_GRACE_MS = 120_000;
let chooserGoneSince: number | null = null;

/** This player, as remembered by this tab (see keepMeJoined). */
let self: Self = { room: '', id: '', joined: false, profile: null };

/**
 * Joins (or creates) the room. Resolves to true when this player still has to pick a name and icon:
 * Playroom's lobby only runs before the game launches, so anyone arriving later skips it.
 */
export async function connect(): Promise<boolean> {
  // Only production builds use the registered gameId: the free plan allows 10 unique users a day, and
  // dev/testing sessions (each test browser is a "new" user) would use them up. Without it, Playroom
  // runs in dev mode.
  const gameId = import.meta.env.PROD ? (import.meta.env.VITE_PLAYROOM_GAME_ID as string | undefined) : undefined;
  await adoptSavedIdentity();
  await insertCoinOrFail({
    skipLobby,
    maxPlayersPerRoom: 12,
    // The server holds a dropped player's seat this long (ms), so a short drop (a phone that briefly slept)
    // goes unnoticed. Their turn waits meanwhile; the word picker can skip it.
    reconnectGracePeriod: 60_000,
    defaultStates: { round: null, scores: {}, danish: false, difficulty: DEFAULT_DIFFICULTY },
    ...(gameId ? { gameId } : {}),
  });

  onPlayerJoin((player) => {
    players.set(player.id, player);
    if (!joinOrder.includes(player.id)) joinOrder.push(player.id);
    player.onQuit(() => players.delete(player.id));
  });

  RPC.register('guess', async (payload: unknown, sender) => {
    handleGuess(payload, sender);
  });

  // When the host launches, everyone in Playroom's lobby is connected. The host records who that
  // was, so anyone missing from the list arrived later and never got to pick a name and icon.
  if (isHost() && getState('lobbyPlayers') == null) {
    // Despite its Record type, getParticipants() returns an array, so take ids from the players.
    setState('lobbyPlayers', Object.values(getParticipants()).map((p) => p.id), true);
  }
  const player = myPlayer();
  holdPlayer(player.id);
  self = loadSelf(roomCode(), player.id) ?? { room: roomCode(), id: player.id, joined: false, profile: null };
  // Dev shortcut, or coming back after a reload or in a new tab.
  if (skipLobby || self.joined || player.getState('joined')) {
    markJoined();
    return false;
  }
  saveSelf(self);
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 5000));
  const lobbyPlayers = await Promise.race([waitForState<string[]>('lobbyPlayers'), timeout]);
  const sawLobby = !!lobbyPlayers?.includes(player.id);
  if (sawLobby) markJoined();
  return !sawLobby;
}

function markJoined(): void {
  self = { ...self, joined: true };
  keepMeJoined();
}

let lastRepair = -Infinity;

/**
 * Called every frame. Puts this player's own `joined` flag and profile back if this client's copy loses
 * them, and keeps a copy of the profile for a reload or a new tab (see identity.ts). When only the host's
 * copy is lost, this client can't tell; the host repairs that (see restoreReturningPlayers).
 */
export function keepMeJoined(): void {
  if (!self.joined) return;
  const player = myPlayer();
  const profile = checkedProfile(player);
  if (profile) {
    const known = self.profile;
    if (known?.name !== profile.name || known.photo !== profile.photo || known.color !== profile.color) {
      self = { ...self, profile };
      saveSelf(self);
    }
  }
  const lostProfile = !profile && self.profile !== null;
  const lostJoined = !player.getState('joined');
  // Wait a moment between repairs, so the host's copy can catch up.
  if ((!lostProfile && !lostJoined) || performance.now() - lastRepair < 1000) return;
  lastRepair = performance.now();
  if (lostProfile) player.setState('profile', { ...rawProfile(player), ...self.profile }, true);
  if (lostJoined) player.setState('joined', true, true);
}

/** A player's profile with each field checked, or null if it has no name. */
function checkedProfile(p: PlayerState): Profile | null {
  const { name, photo } = rawProfile(p);
  if (typeof name !== 'string' || !name.trim()) return null;
  return { name: name.trim().slice(0, MAX_NAME_LENGTH), photo: safePhoto(photo), color: displayColor(p) };
}

/** insertCoin, but also rejecting when Playroom reports an error through its callback. */
function insertCoinOrFail(options: Parameters<typeof insertCoin>[0]): Promise<void> {
  return new Promise((resolve, reject) => {
    insertCoin(options, undefined, reject).then(resolve, reject);
  });
}

/** Name and icon from Playroom's profile, used to prefill the join screen. */
export function myProfile(): { name: string; photo: string } {
  const { name, photo } = rawProfile(myPlayer());
  return { name: typeof name === 'string' ? name.slice(0, MAX_NAME_LENGTH) : '', photo: safePhoto(photo) };
}

export function joinGame(name: string, photo: string): void {
  const player = myPlayer();
  const profile = player.getState('profile') ?? {};
  player.setState('profile', { ...profile, name: name.trim().slice(0, MAX_NAME_LENGTH), photo }, true);
  markJoined();
}

// ---- Read side -------------------------------------------------------------

export const me = (): string => myPlayer().id;
export const amHost = (): boolean => isHost();
export const roomCode = (): string => getRoomCode() ?? '';
export const round = (): RoundState | null => getState('round') ?? null;
export const scores = (): Record<string, number> => getState('scores') ?? {};
export const danish = (): boolean => !!getState('danish');
export function difficulty(): Difficulty {
  const d: unknown = getState('difficulty');
  return isDifficulty(d) ? d : DEFAULT_DIFFICULTY;
}

const isJoined = (p: PlayerState): boolean => !!p.getState('joined');

/** Big enough for Playroom/Multiavatar icons (a few KB), small enough that nobody can bloat memory. */
const MAX_PHOTO_LENGTH = 100_000;

/**
 * Only accept icons embedded as data:image URLs. Profiles are written by each player's own browser,
 * so a remote URL would make everyone fetch it from a server of the sender's choosing (leaking IPs).
 */
function safePhoto(photo: unknown): string {
  return typeof photo === 'string' && photo.startsWith('data:image/') && photo.length <= MAX_PHOTO_LENGTH
    ? photo
    : '';
}

/**
 * A player's raw profile state. Profiles are written by each player's own browser, so we don't use
 * Playroom's getProfile(): it converts the colour and throws if that isn't a string.
 */
function rawProfile(p: PlayerState): Record<string, unknown> {
  const profile: unknown = p.getState('profile');
  return typeof profile === 'object' && profile !== null ? (profile as Record<string, unknown>) : {};
}

/** Anything that isn't a sensible string is ignored. */
function displayName(p: PlayerState): string {
  const raw = rawProfile(p).name;
  const name = typeof raw === 'string' && raw.trim() ? raw.trim() : 'Player';
  // Names from Playroom's lobby aren't length-limited, so cap them for display.
  return name.length > MAX_NAME_LENGTH ? name.slice(0, MAX_NAME_LENGTH - 1) + '…' : name;
}

function displayColor(p: PlayerState): string {
  const raw = rawProfile(p).color;
  return typeof raw === 'string' && /^#[0-9a-f]{6}$/i.test(raw) ? raw : '#888888';
}

type Roster = { joined: Player[]; joining: number };
let roster: Roster | null = null;

/** Scanned once per task (i.e. once per frame) and reused, since the scene asks many times. */
function currentRoster(): Roster {
  if (!roster) {
    const all = [...players.values()];
    roster = {
      joined: all.filter(isJoined).map((p) => {
        const profile = checkedProfile(p);
        if (profile) knownProfiles.set(p.id, profile);
        return { id: p.id, name: displayName(p), color: displayColor(p), photo: safePhoto(rawProfile(p).photo) };
      }),
      joining: all.filter((p) => !isJoined(p)).length,
    };
    for (const p of roster.joined) knownNames.set(p.id, p.name);
    queueMicrotask(() => (roster = null));
  }
  return roster;
}

/** Players who are in the game. People still on the join screen are left out. */
export const playerList = (): Player[] => currentRoster().joined;

/** How many people are connected but still picking a name and icon. */
export const joiningCount = (): number => currentRoster().joining;

const joinedIds = (): string[] => playerList().map((p) => p.id);

export function playerName(id: string): string {
  return playerList().find((p) => p.id === id)?.name ?? knownNames.get(id) ?? 'Someone';
}

/** Whether a player is currently connected (they may be reloading the page). */
export const isConnected = (id: string): boolean => players.has(id);

/** The secret, but only if I'm the chooser of the current round. */
export function mySecret(): string | null {
  const r = round();
  // While choosing there is no word yet: anything stored is from an earlier game that reused this room
  // code (round numbers restart at 1).
  if (!r || r.chooserId !== me() || r.status === 'choosing') return null;
  if (secret?.roundId !== r.id) secret = { roundId: r.id, word: loadSecret(r.id), forgotten: false };
  // Once the round is over the word is public anyway, so don't leave it on the device.
  if (r.status !== 'guessing' && !secret.forgotten) {
    secret.forgotten = true;
    forgetSecret();
  }
  return secret.word;
}

// ---- Host actions ----------------------------------------------------------

export function setDanish(on: boolean): void {
  if (amHost()) setState('danish', on, true);
}

export function setDifficulty(d: Difficulty): void {
  if (amHost()) setState('difficulty', d, true);
}

export function startNextRound(): void {
  if (!amHost()) return;
  const ids = joinedIds();
  if (ids.length < 2) return;
  const prev = round();
  // Rotate the chooser through players in join order, carrying on after the last one even if they left.
  const chooserId = nextInOrder(joinOrder, ids, prev?.chooserId ?? null) ?? ids[0];
  setState('round', newRound((prev?.id ?? 0) + 1, chooserId, danish(), difficulty()), true);
}

export function abandonRound(): void {
  const r = round();
  if (!r || (r.status !== 'choosing' && r.status !== 'guessing')) return;
  if (!amHost() && r.chooserId !== me()) return;
  setState('round', { ...r, status: 'abandoned', word: mySecret() }, true);
}

/**
 * Called every frame by the host: end the round if the chooser left. They get a grace period first,
 * because reloading the page also drops them for a moment, and they come back with their word.
 */
export function hostWatchdog(): void {
  if (amHost()) restoreReturningPlayers();
  const r = round();
  const active = !!r && (r.status === 'choosing' || r.status === 'guessing');
  if (!amHost() || !r || !active || players.has(r.chooserId)) {
    chooserGoneSince = null;
    return;
  }
  chooserGoneSince ??= performance.now();
  if (performance.now() - chooserGoneSince > CHOOSER_GRACE_MS) {
    chooserGoneSince = null;
    setState('round', { ...r, status: 'abandoned' }, true);
  }
}

/**
 * When a player's connection drops, the host drops their player state, and when they reconnect it
 * starts again empty: no `joined` flag (so they show as "+1 joining" and get no turns) and possibly no
 * profile. Their own browser doesn't notice, since its copy still has both, so the host puts back what it
 * remembers of anyone it has seen in the game before.
 */
function restoreReturningPlayers(): void {
  for (const p of players.values()) {
    const known = knownProfiles.get(p.id);
    if (!known) continue;
    if (!checkedProfile(p)) p.setState('profile', { ...known }, true);
    if (!isJoined(p)) p.setState('joined', true, true);
  }
}

/** Called every frame by the word picker: keep the turn valid as guessers join and leave. */
export function chooserWatchdog(): void {
  const r = round();
  if (!r || r.chooserId !== me() || r.status !== 'guessing') return;
  const next = syncTurn(r, joinedIds(), false, joinOrder);
  if (next !== r) setState('round', next, true);
}

/** Pass the turn on, for when someone has wandered off. Word picker only. */
export function skipTurn(): void {
  const r = round();
  if (!r || r.status !== 'guessing' || !r.turnId || r.chooserId !== me()) return;
  setState('round', syncTurn(r, joinedIds(), true, joinOrder), true);
}

// ---- Chooser actions -------------------------------------------------------

export function submitSecret(word: string): void {
  const r = round();
  if (!r || r.status !== 'choosing' || r.chooserId !== me()) return;
  secret = { roundId: r.id, word, forgotten: false };
  storeSecret(r.id, word);
  setState('round', syncTurn(beginGuessing(r, word), joinedIds(), false, joinOrder), true);
}

/** RPC payloads come from other players' browsers, so check their shape before using them. */
function isGuessPayload(payload: unknown): payload is GuessPayload {
  if (typeof payload !== 'object' || payload === null) return false;
  const { kind, value } = payload as Record<string, unknown>;
  return (
    (kind === 'letter' || kind === 'word' || kind === 'pass') &&
    typeof value === 'string' &&
    value.length <= MAX_WORD_LENGTH * 2
  );
}

function handleGuess(payload: unknown, sender: PlayerState): void {
  if (!isGuessPayload(payload)) return;
  const r = round();
  const word = mySecret();
  if (!r || !word || r.status !== 'guessing' || !isJoined(sender)) return;
  const name = displayName(sender);
  const value = payload.value;
  let result: GuessResult;
  if (payload.kind === 'pass') result = applyPass(r, sender.id, name);
  else if (payload.kind === 'word') result = applyWordGuess(r, word, value, sender.id, name);
  else result = applyLetter(r, word, value, sender.id, name);
  if (result.ignored) return;
  setState('round', syncTurn(result.round, joinedIds(), true, joinOrder), true);
  const s = { ...scores() };
  for (const [id, pts] of Object.entries(result.points)) s[id] = (s[id] ?? 0) + pts;
  setState('scores', s, true);
}

// ---- Guesser actions -------------------------------------------------------

export function guess(kind: GuessPayload['kind'], value: string): void {
  const r = round();
  if (!r || !canGuess(r, me()) || !isJoined(myPlayer())) return;
  RPC.call('guess', { kind, value } satisfies GuessPayload, RPC.Mode.OTHERS);
}

/** Words by room code. A browser only needs the word of the round it's picking for in each room. */
const SECRET_KEY = 'hangman:secrets';

function storedSecrets(): Record<string, unknown> {
  return readObject('local', SECRET_KEY) ?? {};
}

function storeSecret(roundId: number, word: string): void {
  // Drop words from old game nights while we're here.
  const kept = Object.entries(storedSecrets()).filter(([, entry]) => freshEntry(entry));
  write('local', SECRET_KEY, JSON.stringify({ ...Object.fromEntries(kept), [roomCode()]: { roundId, word, at: Date.now() } }));
}

function loadSecret(roundId: number): string | null {
  const entry = storedSecrets()[roomCode()];
  if (!freshEntry(entry)) return null;
  const { roundId: id, word } = entry as Record<string, unknown>;
  return id === roundId && typeof word === 'string' ? word : null;
}

function forgetSecret(): void {
  const { [roomCode()]: _gone, ...rest } = storedSecrets();
  write('local', SECRET_KEY, JSON.stringify(rest));
}

function freshEntry(entry: unknown): boolean {
  if (typeof entry !== 'object' || entry === null) return false;
  const { at } = entry as Record<string, unknown>;
  return typeof at === 'number' && Date.now() - at < GAME_NIGHT_MS;
}
