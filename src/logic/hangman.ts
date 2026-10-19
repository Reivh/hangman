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
export const MAX_WRONG = PARTS.length;

export const ALPHABET_EN = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
export const ALPHABET_DA = [...ALPHABET_EN, 'Æ', 'Ø', 'Å'];
export const HIDDEN = '_';
/** Characters that are shown from the start and never guessed. */
const SHOWN = new Set([' ', '-', "'"]);
export const MAX_WORD_LENGTH = 30;

export function alphabet(danish: boolean): string[] {
  return danish ? ALPHABET_DA : ALPHABET_EN;
}

export type RoundStatus = 'choosing' | 'guessing' | 'won' | 'lost' | 'abandoned';

export interface GuessEvent {
  seq: number;
  kind: 'letter' | 'word';
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
  status: RoundStatus;
  masked: string;
  guessed: string[];
  wrongLetters: string[];
  wrongWords: string[];
  wrong: number;
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

export function mask(word: string, guessed: readonly string[]): string {
  return [...word].map((ch) => (SHOWN.has(ch) || guessed.includes(ch) ? ch : HIDDEN)).join('');
}

export function newRound(id: number, chooserId: string, danish: boolean): RoundState {
  return {
    id,
    chooserId,
    danish,
    status: 'choosing',
    masked: '',
    guessed: [],
    wrongLetters: [],
    wrongWords: [],
    wrong: 0,
    word: null,
    lastEvent: null,
  };
}

export function beginGuessing(round: RoundState, word: string): RoundState {
  return { ...round, status: 'guessing', masked: mask(word, []) };
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
  } else if (round.wrong >= MAX_WRONG) {
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
    round.status !== 'guessing' ||
    byId === round.chooserId ||
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
  if (round.status !== 'guessing' || byId === round.chooserId || !normalized.ok) {
    return { round, points: {}, ignored: true };
  }
  const guess = normalized.word;
  if (round.wrongWords.includes(guess)) return { round, points: {}, ignored: true };
  const next: RoundState = { ...round };
  const points: Record<string, number> = {};
  const hit = guess === word;
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
