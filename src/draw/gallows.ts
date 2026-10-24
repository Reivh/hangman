import Phaser from 'phaser';
import { PARTS, type Part } from '../logic/hangman';

// Local coordinates in a 420x480 box, modelled on the classic paper drawing.
type Seg = { kind: 'line'; x1: number; y1: number; x2: number; y2: number };
type Circ = { kind: 'circle'; x: number; y: number; r: number };
type Shape = Seg | Circ;

const L = (x1: number, y1: number, x2: number, y2: number): Seg => ({ kind: 'line', x1, y1, x2, y2 });

export const GALLOWS_W = 420;

const SHAPES: Record<Part, Shape[]> = {
  base: [L(30, 460, 390, 460), L(80, 460, 140, 400), L(200, 460, 140, 400)],
  pole: [L(140, 460, 140, 20)],
  beam: [L(140, 20, 330, 20)],
  brace: [L(140, 85, 205, 20)],
  rope: [L(330, 20, 330, 68)],
  head: [{ kind: 'circle', x: 330, y: 108, r: 40 }],
  body: [L(330, 148, 330, 300)],
  armL: [L(330, 182, 268, 150)],
  armR: [L(330, 182, 392, 150)],
  legL: [L(330, 300, 284, 392)],
  legR: [L(330, 300, 376, 392)],
};

/** Joint dots on the gallows, like the reference sheet. */
const JOINTS: Partial<Record<Part, [number, number][]>> = {
  base: [[80, 460], [200, 460], [140, 400]],
  beam: [[330, 20]],
  brace: [[140, 85], [205, 20]],
};

const INK = 0x111111;
const FAINT = 0xc4c4c4;

export function drawGallows(
  g: Phaser.GameObjects.Graphics,
  ox: number,
  oy: number,
  scale: number,
  /** How many of PARTS are inked in; the rest are dotted. */
  drawn: number,
): void {
  PARTS.forEach((part, i) => {
    const solid = i < drawn;
    for (const s of SHAPES[part]) {
      if (solid) drawSolid(g, s, ox, oy, scale, part === 'base' && s === SHAPES.base[0] ? 7 : 5);
      else drawDotted(g, s, ox, oy, scale);
    }
    if (solid) {
      g.fillStyle(INK);
      for (const [x, y] of JOINTS[part] ?? []) g.fillCircle(ox + x * scale, oy + y * scale, 6 * scale);
    }
  });
}

function drawSolid(g: Phaser.GameObjects.Graphics, s: Shape, ox: number, oy: number, k: number, width: number) {
  g.lineStyle(width * k, INK);
  if (s.kind === 'line') g.lineBetween(ox + s.x1 * k, oy + s.y1 * k, ox + s.x2 * k, oy + s.y2 * k);
  else g.strokeCircle(ox + s.x * k, oy + s.y * k, s.r * k);
}

function drawDotted(g: Phaser.GameObjects.Graphics, s: Shape, ox: number, oy: number, k: number) {
  g.fillStyle(FAINT);
  const gap = 13;
  const dot = 2.6 * k;
  if (s.kind === 'line') {
    const len = Math.hypot(s.x2 - s.x1, s.y2 - s.y1);
    const n = Math.max(1, Math.round(len / gap));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      g.fillCircle(ox + (s.x1 + (s.x2 - s.x1) * t) * k, oy + (s.y1 + (s.y2 - s.y1) * t) * k, dot);
    }
  } else {
    const n = Math.round((2 * Math.PI * s.r) / gap);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      g.fillCircle(ox + (s.x + Math.cos(a) * s.r) * k, oy + (s.y + Math.sin(a) * s.r) * k, dot);
    }
  }
}
