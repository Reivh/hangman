// Fits the hidden word into the space between the gallows and the misses line.

export type WordLine = { text: string; start: number };

const MAX_SLOT = 56;
export const LINE_SPACING = 1.2;
/** Vertical room for the word between the gallows and the misses line. */
const WORD_AREA_H = 180;

/** Pick the line width that gives the biggest letters while the whole word fits its area. */
export function layoutWord(masked: string, width: number): { lines: WordLine[]; slot: number } {
  let best = { lines: [{ text: masked, start: 0 }], slot: 0 };
  for (let perLine = 8; perLine <= 30; perLine++) {
    const lines = wrapWords(masked, perLine);
    const longest = Math.max(...lines.map((l) => l.text.length));
    const byWidth = Math.min(MAX_SLOT, (width - 40) / longest);
    const byHeight = WORD_AREA_H / ((lines.length - 1) * LINE_SPACING + 1);
    const slot = Math.min(byWidth, byHeight);
    // `>=` so that on a tie the wider layout (fewer lines) wins.
    if (slot >= best.slot) best = { lines, slot };
  }
  return best;
}

/**
 * Greedy wrap on spaces. Words longer than a line are split across lines. Each line remembers where it
 * starts in `masked`, so letters can be matched back to the revealed word.
 */
export function wrapWords(masked: string, max: number): WordLine[] {
  const lines: WordLine[] = [];
  let current: WordLine | null = null;
  let pos = 0;
  for (const word of masked.split(' ')) {
    let rest = word;
    let start = pos;
    pos += word.length + 1;
    while (rest.length > max) {
      if (current) lines.push(current);
      current = null;
      lines.push({ text: rest.slice(0, max), start });
      rest = rest.slice(max);
      start += max;
    }
    if (!rest) continue;
    if (current && current.text.length + 1 + rest.length <= max) current.text += ' ' + rest;
    else {
      if (current) lines.push(current);
      current = { text: rest, start };
    }
  }
  if (current) lines.push(current);
  return lines;
}
