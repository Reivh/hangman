// Multiplayer glue on top of Playroom Kit.
//
// Secrecy model: Playroom shared state is visible to every client, so the secret word is
// never written to it. It lives only in the chooser's browser (memory + sessionStorage so
// a reload survives). Guessers send guesses to everyone via RPC; only the chooser's client
// acts on them and publishes the masked result. The host only starts/advances rounds.
import {
  RPC,
  getRoomCode,
  getState,
  insertCoin,
  isHost,
  myPlayer,
  onPlayerJoin,
  setState,
  type PlayerState,
} from 'playroomkit';
import {
  applyLetter,
  applyWordGuess,
  beginGuessing,
  newRound,
  type GuessResult,
  type RoundState,
} from '../logic/hangman';

export interface Player {
  id: string;
  name: string;
  color: string;
}

type GuessPayload = { kind: 'letter' | 'word'; value: string };

const players = new Map<string, PlayerState>();
let secret: { roundId: number; word: string } | null = null;

export async function connect(): Promise<void> {
  const gameId = import.meta.env.VITE_PLAYROOM_GAME_ID as string | undefined;
  // Dev only: ?skiplobby jumps past Playroom's lobby (handy for automated testing).
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
}

// ---- Read side -------------------------------------------------------------

export const me = (): string => myPlayer().id;
export const amHost = (): boolean => isHost();
export const roomCode = (): string => getRoomCode() ?? '';
export const round = (): RoundState | null => getState('round') ?? null;
export const scores = (): Record<string, number> => getState('scores') ?? {};
export const danish = (): boolean => !!getState('danish');

export function playerList(): Player[] {
  return [...players.values()].map((p) => {
    const profile = p.getProfile();
    return { id: p.id, name: profile?.name || 'Player', color: profile?.color?.hexString ?? '#222' };
  });
}

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
  const ids = playerList().map((p) => p.id);
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

// ---- Chooser actions -------------------------------------------------------

export function submitSecret(word: string): void {
  const r = round();
  if (!r || r.status !== 'choosing' || r.chooserId !== me()) return;
  secret = { roundId: r.id, word };
  storage('set', secretKey(r.id), word);
  setState('round', beginGuessing(r, word), true);
}

function handleGuess(payload: GuessPayload, sender: PlayerState): void {
  const r = round();
  const word = mySecret();
  if (!r || !word || r.status !== 'guessing') return;
  const name = sender.getProfile()?.name || 'Someone';
  const result: GuessResult =
    payload.kind === 'letter'
      ? applyLetter(r, word, String(payload.value), sender.id, name)
      : applyWordGuess(r, word, String(payload.value), sender.id, name);
  if (result.ignored) return;
  setState('round', result.round, true);
  const s = { ...scores() };
  for (const [id, pts] of Object.entries(result.points)) s[id] = (s[id] ?? 0) + pts;
  setState('scores', s, true);
}

// ---- Guesser actions -------------------------------------------------------

export function guess(kind: GuessPayload['kind'], value: string): void {
  const r = round();
  if (!r || r.status !== 'guessing' || r.chooserId === me()) return;
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
