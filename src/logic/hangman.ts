// Pure Hangman rules. No networking or rendering here, so it is easy to test.

/** Drawing order: every wrong guess adds the next part. */
export const PARTS = [
  'base',
  'pole',
  'beam',
  'brace',
  'rope',
  'head',
  'body',
  'armL',
  'armR',
  'legL',
  'legR',
] as const;
export type Part = (typeof PARTS)[number];

/** Allowed misses per difficulty. Harder levels draw several parts per miss. */
export const DIFFICULTIES = { easy: 11, normal: 8, hard: 6 } as const;
export type Difficulty = keyof typeof DIFFICULTIES;
export const DEFAULT_DIFFICULTY: Difficulty = 'normal';

export function isDifficulty(value: unknown): value is Difficulty {
  return typeof value === 'string' && Object.hasOwn(DIFFICULTIES, value);
}

/**
 * A round's difficulty. Round state comes from another client, so fall back on anything odd. Rounds
 * started by a build from before difficulty levels (still open somewhere during a release) have none
 * and allow 11 misses, so treat those as easy.
 */
function difficultyOf(value: unknown): Difficulty {
  if (isDifficulty(value)) return value;
  return value === undefined ? 'easy' : DEFAULT_DIFFICULTY;
}

/** Misses allowed in a round. */
export function maxWrong(difficulty: unknown): number {
  return DIFFICULTIES[difficultyOf(difficulty)];
}

/**
 * How many parts are drawn after each miss (cumulative, index = misses - 1), grouped so each miss adds
 * something that reads as one step: arms and legs go on in pairs before the gallows parts are merged.
 */
const STAGES: Record<Difficulty, readonly number[]> = {
  easy: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  normal: [1, 2, 4, 5, 6, 7, 9, 11], // beam+brace, arms, legs
  hard: [2, 5, 6, 7, 9, 11], // base+pole, beam+brace+rope, head, body, arms, legs
};

/** How many of PARTS to draw after `wrong` misses. */
export function partsDrawn(difficulty: unknown, wrong: number): number {
  if (wrong <= 0) return 0;
  const stages = STAGES[difficultyOf(difficulty)];
  return stages[Math.min(wrong, stages.length) - 1];
}

export const ALPHABET_EN = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
export const ALPHABET_DA = [...ALPHABET_EN, 'Æ', 'Ø', 'Å'];
export const HIDDEN = '_';
/** Characters that are shown from the start and never guessed. */
const SHOWN = new Set([' ', '-', "'", '.', ',', '!', '?']);

/** Spaces, hyphens, apostrophes and punctuation are shown from the start and never guessed. */
export const isShown = (ch: string): boolean => SHOWN.has(ch);
export const MAX_WORD_LENGTH = 60;

export function alphabet(danish: boolean): string[] {
  return danish ? ALPHABET_DA : ALPHABET_EN;
}

export type RoundStatus = 'choosing' | 'guessing' | 'won' | 'lost' | 'abandoned';

export interface GuessEvent {
  seq: number;
  kind: 'letter' | 'word' | 'pass';
  value: string;
  byId: string;
  byName: string;
  hit: boolean;
}

/** Everything every player may see. The secret word is only present once the round is over. */
export interface RoundState {
  id: number;
  chooserId: string;
  danish: boolean;
  difficulty: Difficulty;
  status: RoundStatus;
  masked: string;
  guessed: string[];
  wrongLetters: string[];
  wrongWords: string[];
  wrong: number;
  /** Whose turn it is to guess, or null when anyone may guess (fewer than 2 guessers). */
  turnId: string | null;
  word: string | null;
  lastEvent: GuessEvent | null;
}

export type Normalized = { ok: true; word: string } | { ok: false; error: string };

export function normalizeWord(raw: string, danish: boolean): Normalized {
  const word = raw.trim().replace(/\s+/g, ' ').toLocaleUpperCase('da-DK');
  if (!word) return { ok: false, error: 'Type a word or phrase.' };
  if (word.length > MAX_WORD_LENGTH) {
    return { ok: false, error: `Keep it to ${MAX_WORD_LENGTH} characters or fewer.` };
  }
  const letters = alphabet(danish);
  let letterCount = 0;
  for (const ch of word) {
    if (letters.includes(ch)) letterCount++;
    else if (!SHOWN.has(ch)) {
      const hint = !danish && 'ÆØÅ'.includes(ch) ? ' Turn on Danish letters in the lobby.' : '';
      return { ok: false, error: `"${ch}" can't be guessed.${hint}` };
    }
  }
  if (letterCount < 2) return { ok: false, error: 'Use at least 2 letters.' };
  return { ok: true, word };
}

/** Only the letters, so a whole-word guess doesn't have to repeat the spaces and punctuation. */
export function lettersOf(word: string): string {
  return [...word].filter((ch) => !SHOWN.has(ch)).join('');
}

export function mask(word: string, guessed: readonly string[]): string {
  return [...word].map((ch) => (SHOWN.has(ch) || guessed.includes(ch) ? ch : HIDDEN)).join('');
}

export function newRound(id: number, chooserId: string, danish: boolean, difficulty: Difficulty): RoundState {
  return {
    id,
    chooserId,
    danish,
    difficulty,
    status: 'choosing',
    masked: '',
    guessed: [],
    wrongLetters: [],
    wrongWords: [],
    wrong: 0,
    turnId: null,
    word: null,
    lastEvent: null,
  };
}

export function beginGuessing(round: RoundState, word: string): RoundState {
  return { ...round, status: 'guessing', masked: mask(word, []) };
}

/** Turns kick in once at least this many players (besides the word picker) are guessing. */
export const TURN_BASED_FROM = 2;

/**
 * The first of `present` that comes after `after` in `order` (wrapping round), or the first present one
 * when `after` is null. `order` may include players who have left, which is how a departed player's
 * place in the rotation is remembered. Present players missing from `order` go at the end.
 */
export function nextInOrder(
  order: readonly string[],
  present: readonly string[],
  after: string | null,
): string | undefined {
  const full = [...order, ...present.filter((id) => !order.includes(id))];
  const start = after === null ? -1 : full.indexOf(after);
  for (let i = 1; i <= full.length; i++) {
    const id = full[(start + i) % full.length];
    if (present.includes(id)) return id;
  }
  return undefined;
}

/**
 * Make `turnId` match the current guessers: null when there are too few of them or the round is over,
 * otherwise a valid guesser. With `advance`, the turn moves to the next guesser. If the guesser whose
 * turn it was has left, the turn goes to whoever came after them in `order` (join order).
 */
export function syncTurn(
  round: RoundState,
  guessers: readonly string[],
  advance: boolean,
  order: readonly string[] = guessers,
): RoundState {
  const ids = guessers.filter((id) => id !== round.chooserId);
  let turnId: string | null = null;
  if (round.status === 'guessing' && ids.length >= TURN_BASED_FROM) {
    const stays = round.turnId !== null && ids.includes(round.turnId) && !advance;
    turnId = stays ? round.turnId : (nextInOrder(order, ids, round.turnId) ?? null);
  }
  return turnId === round.turnId ? round : { ...round, turnId };
}

/** Whether this player may guess right now. */
export function canGuess(round: RoundState, playerId: string): boolean {
  return (
    round.status === 'guessing' && playerId !== round.chooserId && (round.turnId === null || round.turnId === playerId)
  );
}

export const POINTS = { letter: 1, solve: 3, hanged: 3 } as const;

export interface GuessResult {
  round: RoundState;
  /** Score changes keyed by player id. Empty if the guess was ignored. */
  points: Record<string, number>;
  ignored: boolean;
}

function finish(round: RoundState, word: string, chooserId: string, points: Record<string, number>) {
  if (!round.masked.includes(HIDDEN)) {
    round.status = 'won';
    round.word = word;
  } else if (round.wrong >= maxWrong(round.difficulty)) {
    round.status = 'lost';
    round.word = word;
    points[chooserId] = (points[chooserId] ?? 0) + POINTS.hanged;
  }
}

export function applyLetter(
  round: RoundState,
  word: string,
  rawLetter: string,
  byId: string,
  byName: string,
): GuessResult {
  const letter = rawLetter.toLocaleUpperCase('da-DK');
  if (
    !canGuess(round, byId) ||
    !alphabet(round.danish).includes(letter) ||
    round.guessed.includes(letter)
  ) {
    return { round, points: {}, ignored: true };
  }
  const next: RoundState = { ...round, guessed: [...round.guessed, letter] };
  const points: Record<string, number> = {};
  const hits = [...word].filter((ch) => ch === letter).length;
  if (hits > 0) {
    next.masked = mask(word, next.guessed);
    points[byId] = hits * POINTS.letter;
    if (!next.masked.includes(HIDDEN)) points[byId] += POINTS.solve;
  } else {
    next.wrongLetters = [...round.wrongLetters, letter];
    next.wrong = round.wrong + 1;
  }
  next.lastEvent = event(round, 'letter', letter, byId, byName, hits > 0);
  finish(next, word, round.chooserId, points);
  return { round: next, points, ignored: false };
}

export function applyWordGuess(
  round: RoundState,
  word: string,
  rawGuess: string,
  byId: string,
  byName: string,
): GuessResult {
  const normalized = normalizeWord(rawGuess, round.danish);
  if (!canGuess(round, byId) || !normalized.ok) {
    return { round, points: {}, ignored: true };
  }
  const guess = normalized.word;
  const key = lettersOf(guess);
  if (round.wrongWords.some((w) => lettersOf(w) === key)) return { round, points: {}, ignored: true };
  const next: RoundState = { ...round };
  const points: Record<string, number> = {};
  const hit = key === lettersOf(word);
  if (hit) {
    next.masked = word;
    points[byId] = POINTS.solve;
  } else {
    next.wrongWords = [...round.wrongWords, guess];
    next.wrong = round.wrong + 1;
  }
  next.lastEvent = event(round, 'word', guess, byId, byName, hit);
  finish(next, word, round.chooserId, points);
  return { round: next, points, ignored: false };
}

/** The guesser whose turn it is gives it up. Costs nothing; the caller moves the turn on. */
export function applyPass(round: RoundState, byId: string, byName: string): GuessResult {
  if (round.status !== 'guessing' || round.turnId === null || round.turnId !== byId) {
    return { round, points: {}, ignored: true };
  }
  return { round: { ...round, lastEvent: event(round, 'pass', '', byId, byName, false) }, points: {}, ignored: false };
}

function event(
  round: RoundState,
  kind: GuessEvent['kind'],
  value: string,
  byId: string,
  byName: string,
  hit: boolean,
): GuessEvent {
  return { seq: (round.lastEvent?.seq ?? 0) + 1, kind, value, byId, byName, hit };
}
