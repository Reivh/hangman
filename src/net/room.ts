// Multiplayer glue on top of Playroom Kit.
//
// Secrecy model: Playroom shared state is visible to every client, so the secret word is
// never written to it. It lives only in the chooser's browser (memory + sessionStorage so
// a reload survives). Guessers send guesses to everyone via RPC; only the chooser's client
// acts on them and publishes the masked result. The host only starts/advances rounds.
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
  newRound,
  syncTurn,
  type GuessResult,
  type RoundState,
} from '../logic/hangman';

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
let secret: { roundId: number; word: string } | null = null;

/**
 * Joins (or creates) the room. Resolves to true when this player still has to pick a name and icon:
 * Playroom's lobby only runs before the game launches, so anyone arriving later skips it.
 */
export async function connect(): Promise<boolean> {
  const gameId = import.meta.env.VITE_PLAYROOM_GAME_ID as string | undefined;
  // Dev only: ?skiplobby jumps past Playroom's lobby and our join screen (handy for automated testing).
  const skipLobby = import.meta.env.DEV && new URLSearchParams(location.search).has('skiplobby');
  await insertCoin({
    skipLobby,
    maxPlayersPerRoom: 12,
    defaultStates: { round: null, scores: {}, danish: false },
    ...(gameId ? { gameId } : {}),
  });

  onPlayerJoin((player) => {
    players.set(player.id, player);
    player.onQuit(() => players.delete(player.id));
  });

  RPC.register('guess', async (payload: GuessPayload, sender) => {
    handleGuess(payload, sender);
  });

  // When the host launches, everyone in Playroom's lobby is connected. The host records who that
  // was, so anyone missing from the list arrived later and never got to pick a name and icon.
  if (isHost() && getState('lobbyPlayers') == null) {
    // Despite its Record type, getParticipants() returns an array, so take ids from the players.
    setState('lobbyPlayers', Object.values(getParticipants()).map((p) => p.id), true);
  }
  const player = myPlayer();
  if (skipLobby || player.getState('joined')) {
    player.setState('joined', true, true); // Dev shortcut, or reconnecting after a reload.
    return false;
  }
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 5000));
  const lobbyPlayers = await Promise.race([waitForState<string[]>('lobbyPlayers'), timeout]);
  const sawLobby = !!lobbyPlayers?.includes(player.id);
  if (sawLobby) player.setState('joined', true, true);
  return !sawLobby;
}

/** Name and icon from Playroom's profile, used to prefill the join screen. */
export function myProfile(): { name: string; photo: string } {
  const profile = myPlayer().getProfile();
  return { name: (profile?.name ?? '').slice(0, MAX_NAME_LENGTH), photo: profile?.photo ?? '' };
}

export function joinGame(name: string, photo: string): void {
  const player = myPlayer();
  const profile = player.getState('profile') ?? {};
  player.setState('profile', { ...profile, name: name.trim().slice(0, MAX_NAME_LENGTH), photo }, true);
  player.setState('joined', true, true);
}

// ---- Read side -------------------------------------------------------------

export const me = (): string => myPlayer().id;
export const amHost = (): boolean => isHost();
export const roomCode = (): string => getRoomCode() ?? '';
export const round = (): RoundState | null => getState('round') ?? null;
export const scores = (): Record<string, number> => getState('scores') ?? {};
export const danish = (): boolean => !!getState('danish');

const isJoined = (p: PlayerState): boolean => !!p.getState('joined');

/** Names from Playroom's lobby aren't length-limited, so cap them for display. */
function displayName(p: PlayerState): string {
  const name = p.getProfile()?.name || 'Player';
  return name.length > MAX_NAME_LENGTH ? name.slice(0, MAX_NAME_LENGTH - 1) + '…' : name;
}

type Roster = { joined: Player[]; joining: number };
let roster: Roster | null = null;

/** Scanned once per task (i.e. once per frame) and reused, since the scene asks many times. */
function currentRoster(): Roster {
  if (!roster) {
    const all = [...players.values()];
    roster = {
      joined: all.filter(isJoined).map((p) => ({
        id: p.id,
        name: displayName(p),
        color: p.getProfile()?.color?.hexString ?? '#222',
        photo: p.getProfile()?.photo ?? '',
      })),
      joining: all.filter((p) => !isJoined(p)).length,
    };
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
  return playerList().find((p) => p.id === id)?.name ?? 'Someone';
}

/** The secret, but only if I'm the chooser of the current round. */
export function mySecret(): string | null {
  const r = round();
  if (!r || r.chooserId !== me()) return null;
  if (secret?.roundId !== r.id) {
    const stored = storage('get', secretKey(r.id));
    secret = stored ? { roundId: r.id, word: stored } : null;
  }
  return secret?.word ?? null;
}

// ---- Host actions ----------------------------------------------------------

export function setDanish(on: boolean): void {
  if (amHost()) setState('danish', on, true);
}

export function startNextRound(): void {
  if (!amHost()) return;
  const ids = joinedIds();
  if (ids.length < 2) return;
  const prev = round();
  // Rotate the chooser through players in join order.
  const prevIndex = prev ? ids.indexOf(prev.chooserId) : -1;
  const chooserId = ids[(prevIndex + 1) % ids.length];
  setState('round', newRound((prev?.id ?? 0) + 1, chooserId, danish()), true);
}

export function abandonRound(): void {
  const r = round();
  if (!r || (r.status !== 'choosing' && r.status !== 'guessing')) return;
  if (!amHost() && r.chooserId !== me()) return;
  setState('round', { ...r, status: 'abandoned', word: mySecret() }, true);
}

/** Called every frame by the host: end the round if the chooser left. */
export function hostWatchdog(): void {
  const r = round();
  if (!amHost() || !r) return;
  if ((r.status === 'choosing' || r.status === 'guessing') && !players.has(r.chooserId)) {
    setState('round', { ...r, status: 'abandoned' }, true);
  }
}

/** Called every frame by the word picker: keep the turn valid as guessers join and leave. */
export function chooserWatchdog(): void {
  const r = round();
  if (!r || r.chooserId !== me() || r.status !== 'guessing') return;
  const next = syncTurn(r, joinedIds(), false);
  if (next !== r) setState('round', next, true);
}

/** Pass the turn on, for when someone has wandered off. Word picker only. */
export function skipTurn(): void {
  const r = round();
  if (!r || r.status !== 'guessing' || !r.turnId || r.chooserId !== me()) return;
  setState('round', syncTurn(r, joinedIds(), true), true);
}

// ---- Chooser actions -------------------------------------------------------

export function submitSecret(word: string): void {
  const r = round();
  if (!r || r.status !== 'choosing' || r.chooserId !== me()) return;
  secret = { roundId: r.id, word };
  storage('set', secretKey(r.id), word);
  setState('round', syncTurn(beginGuessing(r, word), joinedIds(), false), true);
}

function handleGuess(payload: GuessPayload, sender: PlayerState): void {
  const r = round();
  const word = mySecret();
  if (!r || !word || r.status !== 'guessing' || !isJoined(sender)) return;
  const name = displayName(sender);
  const value = String(payload.value);
  let result: GuessResult;
  if (payload.kind === 'pass') result = applyPass(r, sender.id, name);
  else if (payload.kind === 'word') result = applyWordGuess(r, word, value, sender.id, name);
  else result = applyLetter(r, word, value, sender.id, name);
  if (result.ignored) return;
  setState('round', syncTurn(result.round, joinedIds(), true), true);
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

function secretKey(roundId: number): string {
  return `hangman:${roomCode()}:${roundId}`;
}

/** sessionStorage can throw in private mode or embedded webviews; the game works without it. */
function storage(op: 'get' | 'set', key: string, value = ''): string | null {
  try {
    if (op === 'get') return sessionStorage.getItem(key);
    sessionStorage.setItem(key, value);
  } catch {
    // Ignore: a reload will just lose the word.
  }
  return null;
}
