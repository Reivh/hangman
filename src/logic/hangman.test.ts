import { describe, expect, it } from 'vitest';
import {
  MAX_WORD_LENGTH,
  MAX_WRONG,
  applyLetter,
  applyPass,
  applyWordGuess,
  beginGuessing,
  mask,
  newRound,
  nextInOrder,
  normalizeWord,
  syncTurn,
} from './hangman';

const start = (word: string, danish = false) => beginGuessing(newRound(1, 'chooser', danish), word);

describe('normalizeWord', () => {
  it('uppercases and collapses whitespace', () => {
    expect(normalizeWord('  hello   world ', false)).toEqual({ ok: true, word: 'HELLO WORLD' });
  });
  it('rejects Danish letters unless enabled', () => {
    expect(normalizeWord('rødgrød', false).ok).toBe(false);
    expect(normalizeWord('rødgrød', true)).toEqual({ ok: true, word: 'RØDGRØD' });
  });
  it('allows phrases up to MAX_WORD_LENGTH characters', () => {
    expect(normalizeWord('a'.repeat(MAX_WORD_LENGTH), false).ok).toBe(true);
    expect(normalizeWord('a'.repeat(MAX_WORD_LENGTH + 1), false).ok).toBe(false);
  });
  it('rejects digits and too-short words', () => {
    expect(normalizeWord('abc1', false).ok).toBe(false);
    expect(normalizeWord('a', false).ok).toBe(false);
  });
});

describe('mask', () => {
  it('hides unguessed letters but shows spaces and hyphens', () => {
    expect(mask("X-RAY DON'T", ['A'])).toBe("_-_A_ ___'_");
  });
});

describe('applyLetter', () => {
  it('reveals every occurrence and scores per hit', () => {
    const { round, points } = applyLetter(start('BANANA'), 'BANANA', 'a', 'p1', 'Ann');
    expect(round.masked).toBe('_A_A_A');
    expect(points).toEqual({ p1: 3 });
    expect(round.wrong).toBe(0);
  });

  it('adds a part on a miss and ignores repeats and the chooser', () => {
    let r = applyLetter(start('CAT'), 'CAT', 'Z', 'p1', 'Ann').round;
    expect(r.wrong).toBe(1);
    expect(applyLetter(r, 'CAT', 'Z', 'p2', 'Bo').ignored).toBe(true);
    expect(applyLetter(r, 'CAT', 'C', 'chooser', 'Cy').ignored).toBe(true);
  });

  it('wins when the last letter is found, revealing the word', () => {
    let r = start('AB');
    r = applyLetter(r, 'AB', 'A', 'p1', 'Ann').round;
    const res = applyLetter(r, 'AB', 'B', 'p2', 'Bo');
    expect(res.round.status).toBe('won');
    expect(res.round.word).toBe('AB');
    expect(res.points).toEqual({ p2: 1 + 3 });
  });

  it('loses after MAX_WRONG misses and rewards the chooser', () => {
    let r = start('Q');
    const misses = 'ABCDEFGHIJKLMNOP'.slice(0, MAX_WRONG);
    let last;
    for (const ch of misses) {
      last = applyLetter(r, 'QQ', ch, 'p1', 'Ann');
      r = last.round;
    }
    expect(r.status).toBe('lost');
    expect(r.word).toBe('QQ');
    expect(last!.points).toEqual({ chooser: 3 });
    expect(applyLetter(r, 'QQ', 'Q', 'p1', 'Ann').ignored).toBe(true);
  });
});

describe('applyWordGuess', () => {
  it('solves on a correct guess, case-insensitive', () => {
    const res = applyWordGuess(start('HELLO WORLD'), 'HELLO WORLD', ' hello  world', 'p1', 'Ann');
    expect(res.round.status).toBe('won');
    expect(res.points).toEqual({ p1: 3 });
  });
  it('costs a part on a wrong guess', () => {
    const res = applyWordGuess(start('HELLO'), 'HELLO', 'HELLA', 'p1', 'Ann');
    expect(res.round.wrong).toBe(1);
    expect(res.round.wrongWords).toEqual(['HELLA']);
  });
});

describe('turns', () => {
  const guessers = ['chooser', 'p1', 'p2', 'p3'];

  it('stays free-for-all with a single guesser', () => {
    expect(syncTurn(start('CAT'), ['chooser', 'p1'], false).turnId).toBeNull();
  });

  it('starts with the first guesser and rotates, skipping the chooser', () => {
    let r = syncTurn(start('CAT'), guessers, false);
    expect(r.turnId).toBe('p1');
    r = syncTurn(r, guessers, true);
    expect(r.turnId).toBe('p2');
    r = syncTurn(syncTurn(r, guessers, true), guessers, true);
    expect(r.turnId).toBe('p1');
  });

  it('rejects guesses out of turn', () => {
    const r = syncTurn(start('CAT'), guessers, false);
    expect(applyLetter(r, 'CAT', 'C', 'p2', 'Bo').ignored).toBe(true);
    expect(applyWordGuess(r, 'CAT', 'CAT', 'p2', 'Bo').ignored).toBe(true);
    expect(applyLetter(r, 'CAT', 'C', 'p1', 'Ann').ignored).toBe(false);
  });

  it('lets only the current guesser pass, at no cost', () => {
    const r = syncTurn(start('CAT'), guessers, false);
    expect(applyPass(r, 'p2', 'Bo').ignored).toBe(true);
    const res = applyPass(r, 'p1', 'Ann');
    expect(res.ignored).toBe(false);
    expect(res.round.wrong).toBe(0);
    expect(res.round.lastEvent).toMatchObject({ kind: 'pass', byId: 'p1' });
    expect(applyPass(start('CAT'), 'p1', 'Ann').ignored).toBe(true); // No turns, nothing to pass.
  });

  it('goes free-for-all below 2 guessers', () => {
    const r = syncTurn(start('CAT'), guessers, false);
    expect(syncTurn(r, ['chooser', 'p3'], false).turnId).toBeNull();
  });

  it('gives a departed guesser’s turn to whoever came after them, not back to the first', () => {
    const order = ['chooser', 'p1', 'p2', 'p3', 'p4'];
    const r = { ...start('CAT'), turnId: 'p3' };
    expect(syncTurn(r, ['chooser', 'p1', 'p2', 'p4'], false, order).turnId).toBe('p4');
    // Wraps round: the last guesser left, so the first goes next.
    const last = { ...start('CAT'), turnId: 'p4' };
    expect(syncTurn(last, ['chooser', 'p1', 'p2', 'p3'], false, order).turnId).toBe('p1');
  });
});

describe('nextInOrder', () => {
  const order = ['a', 'b', 'c', 'd'];
  it('picks the next present player after the given one, wrapping round', () => {
    expect(nextInOrder(order, ['a', 'b', 'c', 'd'], 'b')).toBe('c');
    expect(nextInOrder(order, ['a', 'b', 'c', 'd'], 'd')).toBe('a');
  });
  it('skips players who have left, remembering where the missing one sat', () => {
    expect(nextInOrder(order, ['a', 'd'], 'b')).toBe('d');
  });
  it('starts with the first present player when there is no previous one', () => {
    expect(nextInOrder(order, ['c', 'd'], null)).toBe('c');
    expect(nextInOrder(order, [], 'a')).toBeUndefined();
  });
  it('puts players missing from the order at the end', () => {
    expect(nextInOrder(['a'], ['a', 'z'], 'a')).toBe('z');
  });
});
