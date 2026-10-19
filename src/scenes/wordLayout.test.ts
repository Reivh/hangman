import { describe, expect, it } from 'vitest';
import { MAX_WORD_LENGTH } from '../logic/hangman';
import { LINE_SPACING, layoutWord, wrapWords } from './wordLayout';

const AREA = 180;
const height = (lines: number, slot: number) => ((lines - 1) * LINE_SPACING + 1) * slot;

describe('wrapWords', () => {
  it('wraps on spaces and records where each line starts', () => {
    expect(wrapWords('HANG MAN GAME', 8)).toEqual([
      { text: 'HANG MAN', start: 0 },
      { text: 'GAME', start: 9 },
    ]);
  });
  it('splits words longer than a line', () => {
    expect(wrapWords('ABCDEFGHIJ XY', 4)).toEqual([
      { text: 'ABCD', start: 0 },
      { text: 'EFGH', start: 4 },
      { text: 'IJ', start: 8 },
      { text: 'XY', start: 11 },
    ]);
  });
});

describe('layoutWord', () => {
  it('keeps short words on one line at full size', () => {
    expect(layoutWord('HANGMAN', 720)).toEqual({ lines: [{ text: 'HANGMAN', start: 0 }], slot: 56 });
  });

  const cases = {
    'a 60-letter word': 'A'.repeat(MAX_WORD_LENGTH),
    'many 13-letter words': 'ABCDEFGHIJKLM ABCDEFGHIJKLM ABCDEFGHIJKLM ABCDEFGHIJKL',
    'a 57-char phrase': 'THE QUICK BROWN FOX JUMPS OVER THE LAZY DOG AND RUNS AWAY',
  };
  for (const [name, word] of Object.entries(cases)) {
    it(`fits ${name} in the area with readable letters`, () => {
      const { lines, slot } = layoutWord(word, 720);
      expect(height(lines.length, slot)).toBeLessThanOrEqual(AREA + 0.001);
      expect(Math.max(...lines.map((l) => l.text.length)) * slot).toBeLessThanOrEqual(680 + 0.001);
      expect(slot).toBeGreaterThanOrEqual(28);
      // Every character is placed exactly once, at the right position.
      for (const l of lines) expect(word.slice(l.start, l.start + l.text.length)).toBe(l.text);
    });
  }
});
