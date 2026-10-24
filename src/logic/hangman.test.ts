import { describe, expect, it } from 'vitest';
import {
  DIFFICULTIES,
  MAX_WORD_LENGTH,
  PARTS,
  applyLetter,
  applyPass,
  applyWordGuess,
  beginGuessing,
  mask,
  newRound,
  maxWrong,
  nextInOrder,
  normalizeWord,
  partsDrawn,
  syncTurn,
  type Difficulty,
} from './hangman';

const start = (word: string, danish = false, difficulty: Difficulty = 'easy') =>
  beginGuessing(newRound(1, 'chooser', danish, difficulty), word);

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
  it('allows punctuation for short sentences', () => {
    expect(normalizeWord("i'm here. ok, go! why?", false)).toEqual({ ok: true, word: "I'M HERE. OK, GO! WHY?" });
  });
  it('rejects digits and too-short words', () => {
    expect(normalizeWord('abc1', false).ok).toBe(false);
    expect(normalizeWord('a', false).ok).toBe(false);
  });
});

describe('mask', () => {
  it('hides unguessed letters but shows spaces, hyphens and punctuation', () => {
    expect(mask("X-RAY DON'T", ['A'])).toBe("_-_A_ ___'_");
    expect(mask('HI, YOU. GO!?', [])).toBe('__, ___. __!?');
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

  it('loses after the allowed misses and rewards the chooser', () => {
    let r = start('Q');
    const misses = 'ABCDEFGHIJKLMNOP'.slice(0, maxWrong('easy'));
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
  it('ignores spaces and punctuation the guesser left out', () => {
    const word = "HI, IT'S ME.";
    expect(applyWordGuess(start(word), word, 'hi its me', 'p1', 'Ann').round.status).toBe('won');
    expect(applyWordGuess(start(word), word, "hi, it's me.", 'p1', 'Ann').round.status).toBe('won');
  });
  it('treats the same letters with different punctuation as a repeat', () => {
    const r = applyWordGuess(start('HELLO'), 'HELLO', 'HEL LA', 'p1', 'Ann').round;
    expect(applyWordGuess(r, 'HELLO', 'HELLA!', 'p2', 'Bo').ignored).toBe(true);
  });
  it('costs a part on a wrong guess', () => {
    const res = applyWordGuess(start('HELLO'), 'HELLO', 'HELLA', 'p1', 'Ann');
    expect(res.round.wrong).toBe(1);
    expect(res.round.wrongWords).toEqual(['HELLA']);
  });
});

describe('difficulty', () => {
  it('allows 11, 8 or 6 misses', () => {
    expect(DIFFICULTIES).toEqual({ easy: 11, normal: 8, hard: 6 });
    for (const d of ['easy', 'normal', 'hard'] as const) {
      let r = start('QQ', false, d);
      for (const ch of 'ABCDEFGHIJK'.slice(0, maxWrong(d))) {
        expect(r.status).toBe('guessing');
        r = applyLetter(r, 'QQ', ch, 'p1', 'Ann').round;
      }
      expect(r.status).toBe('lost');
    }
  });
  it('falls back to normal on a bad value from another client', () => {
    expect(maxWrong('impossible')).toBe(8);
    expect(maxWrong(null)).toBe(8);
  });
  it('treats rounds from builds without difficulty levels as easy (11 misses)', () => {
    expect(maxWrong(undefined)).toBe(11);
    expect(partsDrawn(undefined, 3)).toBe(3);
  });
  it('draws more parts per miss on harder levels, finishing the man on the last miss', () => {
    for (const d of ['easy', 'normal', 'hard'] as const) {
      const drawn = Array.from({ length: maxWrong(d) + 1 }, (_, wrong) => partsDrawn(d, wrong));
      expect(drawn[0]).toBe(0);
      expect(drawn.at(-1)).toBe(PARTS.length);
      for (let i = 1; i < drawn.length; i++) expect(drawn[i]).toBeGreaterThan(drawn[i - 1]);
    }
    expect(partsDrawn('hard', 99)).toBe(PARTS.length);
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
