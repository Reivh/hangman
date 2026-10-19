import { describe, expect, it } from 'vitest';
import {
  MAX_WRONG,
  applyLetter,
  applyWordGuess,
  beginGuessing,
  mask,
  newRound,
  normalizeWord,
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
