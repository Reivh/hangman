import Phaser from 'phaser';
import * as net from '../net/room';
import { GALLOWS_W, drawGallows } from '../draw/gallows';
import { HIDDEN, MAX_WRONG, alphabet, canGuess, isShown, normalizeWord, type RoundState } from '../logic/hangman';
import { closePrompt, isPromptOpen, openPrompt } from '../ui/prompt';
import { LINE_SPACING, layoutWord } from './wordLayout';

export const WIDTH = 720;
export const HEIGHT = 1280;

const INK = 0x111111;
const PAPER = 0xffffff;
const MUTED = 0xd6d6d6;
const RED = '#c0392b';
const SERIF = '"Bodoni Moda", "Didot", Georgia, serif';
const SANS = 'Helvetica, Arial, sans-serif';
const HAND = '"Patrick Hand", "Comic Sans MS", cursive';

const GALLOWS_SCALE = 0.8;
const GALLOWS_Y = 150;
const WORD_Y = 640;
const KEYS_Y = 818;
const BUTTON_Y = 1118;
const BOX_Y = 1162;

type TextStyle = Phaser.Types.GameObjects.Text.TextStyle;

export class GameScene extends Phaser.Scene {
  private ui!: Phaser.GameObjects.Container;
  private lastSnapshot = '';
  private lastRoundId = -1;
  private lastWrong = 0;
  /** Round id + event seq of the last animated event (seq restarts every round). */
  private lastEventKey = '';
  private autoPromptedRound = -1;
  /** Letters I tapped that the chooser hasn't confirmed yet. */
  private pending = new Set<string>();
  /** Which round/status the open prompt belongs to, so it closes if the game moves on. */
  private promptContext: string | null = null;

  constructor() {
    super('game');
  }

  create(): void {
    this.ui = this.add.container(0, 0);
    this.input.keyboard?.on('keydown', (e: KeyboardEvent) => {
      if (isPromptOpen() || e.target instanceof HTMLInputElement) return;
      if (e.ctrlKey || e.metaKey || e.altKey || e.key.length !== 1) return;
      this.tryGuessLetter(e.key.toLocaleUpperCase('da-DK'));
    });
  }

  update(): void {
    net.hostWatchdog();
    net.chooserWatchdog();
    const round = net.round();
    const snapshot = JSON.stringify([
      round,
      net.scores(),
      // Icons can be large data URLs; their length and tail are enough to notice a change.
      net.playerList().map((p) => [p.id, p.name, p.color, p.photo.length, p.photo.slice(-32)]),
      round ? net.isConnected(round.chooserId) : true,
      net.joiningCount(),
      net.amHost(),
      net.danish(),
      net.mySecret() !== null,
      [...this.pending],
    ]);
    if (snapshot !== this.lastSnapshot) {
      this.lastSnapshot = snapshot;
      this.render();
    }
  }

  // ---------------------------------------------------------------------------

  private render(): void {
    this.ui.removeAll(true);
    const round = net.round();
    const meId = net.me();

    if (round?.id !== this.lastRoundId) {
      this.pending.clear();
      this.lastWrong = 0;
    }
    if (round) for (const l of round.guessed) this.pending.delete(l);
    // The word picker silently drops out-of-turn guesses, so don't leave those keys greyed out.
    if (!round || !canGuess(round, meId)) this.pending.clear();
    if (this.promptContext && this.promptContext !== contextOf(round)) {
      closePrompt();
      this.promptContext = null;
    }

    this.renderHeader(round);

    const g = this.add.graphics();
    this.ui.add(g);
    const gx = (WIDTH - GALLOWS_W * GALLOWS_SCALE) / 2;
    drawGallows(g, gx, GALLOWS_Y, GALLOWS_SCALE, round?.wrong ?? 0);

    if (!round) this.renderLobby();
    else if (round.status === 'choosing') this.renderChoosing(round, meId);
    else this.renderPlay(round, meId);
    if (round) this.renderEndRound(round, meId);

    this.renderPlayersBox(round);
    this.reactToChanges(round);
  }

  private renderHeader(round: RoundState | null): void {
    this.text(WIDTH / 2, 50, 'THE HANGMAN', { fontFamily: SERIF, fontSize: '54px', fontStyle: '600' });

    const code = net.roomCode();
    const invite = this.text(WIDTH / 2, 98, `Room ${code} · tap to invite`, {
      fontFamily: SANS,
      fontSize: '20px',
      color: '#777',
    });
    invite.setInteractive({ useHandCursor: true }).on('pointerup', () => shareLink(code));

    let status = 'Waiting in the lobby';
    if (round) {
      const chooser = round.chooserId === net.me() ? 'You' : net.playerName(round.chooserId);
      status = `Round ${round.id} · ${chooser} ${round.chooserId === net.me() ? 'pick' : 'picks'} the word`;
    }
    this.text(WIDTH / 2, 128, status, { fontFamily: SANS, fontSize: '22px', color: '#333' });
  }

  private renderLobby(): void {
    const count = net.playerList().length;
    this.text(WIDTH / 2, WORD_Y - 20, 'Gather your friends!', { fontFamily: SERIF, fontSize: '40px' });
    this.text(
      WIDTH / 2,
      WORD_Y + 40,
      'Players take turns picking a secret word.\nEveryone else guesses letters before the man is hung.',
      { fontFamily: SANS, fontSize: '22px', color: '#444', align: 'center', lineSpacing: 6 },
    );
    this.renderRules();

    if (net.amHost()) {
      const danish = net.danish();
      this.button(WIDTH / 2 - 170, BUTTON_Y, 300, `Danish ÆØÅ: ${danish ? 'ON' : 'OFF'}`, true, () =>
        net.setDanish(!danish),
      );
      this.button(WIDTH / 2 + 170, BUTTON_Y, 300, count < 2 ? 'Need 2+ players' : 'Start game', count >= 2, () =>
        net.startNextRound(),
      );
    } else {
      this.note(BUTTON_Y, 'Waiting for the host to start…');
    }
  }

  private renderRules(): void {
    const lines = [
      `• Every wrong letter adds a part — ${MAX_WRONG} misses and he's hung.`,
      '• Correct letter: +1 per letter revealed. Solve it: +3.',
      '• With 2+ guessers you take turns: one guess each, or Pass.',
      '• Guess the whole word on your go, but a wrong guess costs a part.',
      '• If he hangs, the word-picker gets +3.',
    ];
    this.text(WIDTH / 2, KEYS_Y + 120, lines.join('\n'), {
      fontFamily: SANS,
      fontSize: '21px',
      color: '#555',
      lineSpacing: 12,
    });
  }

  private renderChoosing(round: RoundState, meId: string): void {
    const mine = round.chooserId === meId;
    if (mine) {
      this.text(WIDTH / 2, WORD_Y, "It's your turn to pick a secret word!", { fontFamily: SERIF, fontSize: '34px' });
      this.button(WIDTH / 2, KEYS_Y + 120, 360, 'Choose word', true, () => this.promptSecret(round));
      if (this.autoPromptedRound !== round.id) {
        this.autoPromptedRound = round.id;
        this.promptSecret(round);
      }
    } else {
      this.text(WIDTH / 2, WORD_Y, `${net.playerName(round.chooserId)} is choosing a word…`, {
        fontFamily: SERIF,
        fontSize: '34px',
      });
      this.renderRules();
    }
  }

  private renderPlay(round: RoundState, meId: string): void {
    const mine = round.chooserId === meId;
    const over = round.status !== 'guessing';
    const secret = round.word ?? (mine ? net.mySecret() : null);

    this.renderWord(round.masked, secret, round.status === 'lost' || round.status === 'abandoned', mine && !over);

    const wrongWords = round.wrongWords.length ? ` · Wrong words: ${round.wrongWords.join(', ')}` : '';
    const myTurn = canGuess(round, meId);
    let turn = '';
    if (!over && round.turnId) {
      turn = round.turnId === meId ? ' · Your turn!' : ` · ${net.playerName(round.turnId)}'s turn`;
    }
    this.text(WIDTH / 2, 756, `Misses ${round.wrong} / ${MAX_WRONG}${turn}${wrongWords}`, {
      fontFamily: SANS,
      fontSize: '22px',
      color: '#333',
      wordWrap: { width: WIDTH - 40 },
      align: 'center',
    });
    this.renderEventLine(round);

    this.renderKeyboard(round, myTurn);

    if (round.status === 'guessing') {
      if (mine) {
        if (round.turnId) {
          const name = net.playerName(round.turnId);
          this.button(WIDTH / 2, BUTTON_Y, 400, `Skip ${name}'s turn`, true, () => net.skipTurn(), true);
        } else this.note(BUTTON_Y, 'Your word is hidden from everyone else. Watch them sweat!');
        if (secret === null) {
          this.note(BUTTON_Y - 50, 'Lost your word after switching device —\nuse End round (top right).', RED);
        }
      } else if (myTurn && round.turnId) {
        this.button(280, BUTTON_Y, 420, 'Guess the whole word', true, () => this.promptWordGuess(round));
        this.button(590, BUTTON_Y, 180, 'Pass', true, () => net.guess('pass', ''), true);
      } else if (myTurn) {
        this.button(WIDTH / 2, BUTTON_Y, 440, 'Guess the whole word', true, () => this.promptWordGuess(round));
      } else {
        this.note(BUTTON_Y, `Waiting for ${net.playerName(round.turnId ?? '')}…`);
      }
    } else if (net.amHost()) {
      const enough = net.playerList().length >= 2;
      this.button(WIDTH / 2, BUTTON_Y, 360, enough ? 'Next round' : 'Need 2+ players', enough, () =>
        net.startNextRound(),
      );
    } else {
      this.note(BUTTON_Y, 'Waiting for the host to start the next round…');
    }
  }

  /** Letter slots, wrapped on spaces. `reveal` fills hidden slots (grey for the chooser, red after a loss). */
  private renderWord(masked: string, reveal: string | null, lost: boolean, chooserView: boolean): void {
    const { lines, slot } = layoutWord(masked, WIDTH);
    const font = Math.round(slot * 0.78);
    const lineH = slot * LINE_SPACING;
    const top = WORD_Y - ((lines.length - 1) * lineH) / 2;
    const g = this.add.graphics();
    this.ui.add(g);
    g.lineStyle(Math.max(2, slot / 14), INK);

    lines.forEach((line, row) => {
      const y = top + row * lineH;
      const left = (WIDTH - line.text.length * slot) / 2;
      [...line.text].forEach((ch, col) => {
        const cx = left + col * slot + slot / 2;
        const under = y + font * 0.6;
        if (!isShown(ch)) g.lineBetween(cx - slot * 0.38, under, cx + slot * 0.38, under);
        let shown = ch;
        let color = '#111';
        if (ch === HIDDEN) {
          shown = reveal?.[line.start + col] ?? '';
          color = lost ? RED : chooserView ? '#aaa' : '#111';
        }
        if (shown && shown !== ' ') {
          this.text(cx, y, shown, { fontFamily: SANS, fontSize: `${font}px`, fontStyle: 'bold', color });
        }
      });
    });
  }

  private renderEventLine(round: RoundState): void {
    const e = round.lastEvent;
    let msg = '';
    if (round.status === 'won') msg = `${e?.byName ?? 'Someone'} saved him! 🎉`;
    else if (round.status === 'lost') msg = 'He was hung. The word is revealed.';
    else if (round.status === 'abandoned') msg = 'Round ended early.';
    else if (e) {
      const who = e.byId === net.me() ? 'You' : e.byName;
      msg = e.kind === 'pass' ? `${who} passed` : `${who} guessed ${e.value} ${e.hit ? '✓' : '✗'}`;
    } else msg = round.chooserId === net.me() ? 'Waiting for the first guess…' : 'Tap a letter to guess!';
    if (!e && round.status === 'guessing' && round.turnId === net.me()) msg = 'Your turn — tap a letter!';
    // The host waits a little before ending the round, in case the word picker is just reloading.
    if (round.status === 'guessing' && !net.isConnected(round.chooserId)) {
      msg = `Waiting for ${net.playerName(round.chooserId)} to reconnect…`;
    }
    const t = this.text(WIDTH / 2, 790, msg, {
      fontFamily: HAND,
      fontSize: '28px',
      color: e && !e.hit && e.kind !== 'pass' && round.status === 'guessing' ? RED : '#111',
    });
    const eventKey = e ? `${round.id}:${e.seq}` : '';
    if (e && eventKey !== this.lastEventKey) {
      this.lastEventKey = eventKey;
      t.setScale(1.3);
      this.tweens.add({ targets: t, scale: 1, duration: 250, ease: 'Back.Out' });
    }
  }

  private renderKeyboard(round: RoundState, enabled: boolean): void {
    const letters = alphabet(round.danish);
    const cols = 9;
    const kw = 68;
    const kh = 60;
    const gap = 8;
    const left = (WIDTH - (cols * kw + (cols - 1) * gap)) / 2;
    const rows = Math.ceil(letters.length / cols);

    letters.forEach((letter, i) => {
      const row = Math.floor(i / cols);
      const inRow = row === rows - 1 ? letters.length - row * cols : cols;
      const rowLeft = left + ((cols - inRow) * (kw + gap)) / 2;
      const x = rowLeft + (i % cols) * (kw + gap) + kw / 2;
      const y = KEYS_Y + row * (kh + gap) + kh / 2;

      const guessed = round.guessed.includes(letter);
      const miss = round.wrongLetters.includes(letter);
      const pending = this.pending.has(letter);
      const live = enabled && !guessed && !pending;

      const fill = guessed && !miss ? INK : miss ? 0xf0f0f0 : pending ? MUTED : PAPER;
      const key = this.add.rectangle(x, y, kw, kh, fill).setStrokeStyle(3, miss ? MUTED : INK);
      this.ui.add(key);
      const color = guessed && !miss ? '#fff' : miss ? '#aaa' : enabled ? '#111' : '#999';
      this.text(x, y, letter, { fontFamily: SANS, fontSize: '30px', fontStyle: 'bold', color });
      if (miss) {
        const strike = this.add.graphics().lineStyle(4, INK).lineBetween(x - 22, y + 18, x + 22, y - 18);
        this.ui.add(strike);
      }
      if (live) key.setInteractive({ useHandCursor: true }).on('pointerup', () => this.tryGuessLetter(letter));
    });
  }

  /**
   * Escape hatch for a stuck round (e.g. the word picker wandered off). Kept small and in the corner,
   * away from the guessing controls, and confirmed first, because it ends the round for everyone.
   */
  private renderEndRound(round: RoundState, meId: string): void {
    if (round.status !== 'choosing' && round.status !== 'guessing') return;
    const lostWord = round.status === 'guessing' && round.chooserId === meId && net.mySecret() === null;
    if (!net.amHost() && !lostWord) return;
    this.button(WIDTH - 80, 96, 124, 'End round', true, () => {
      if (window.confirm('End this round for everyone? Nobody wins it.')) net.abandonRound();
    }, true, 36);
  }

  private renderPlayersBox(round: RoundState | null): void {
    const g = this.add.graphics();
    this.ui.add(g);
    g.lineStyle(4, INK).strokeRoundedRect(30, BOX_Y, WIDTH - 60, 106, 24);
    const rows = this.renderPlayerChips(round);

    let headline = 'PLAYERS';
    if (round?.status === 'won') headline = 'WINNER : The guessers!';
    else if (round?.status === 'lost') headline = `WINNER : ${net.playerName(round.chooserId)}`;
    else if (round?.status === 'abandoned') headline = 'WINNER : nobody this time';
    // With two rows of players the heading shrinks to make room.
    const [headY, headSize] = rows > 1 ? [BOX_Y + 22, 28] : [BOX_Y + 30, 34];
    const head = this.text(56, headY, headline, { fontFamily: HAND, fontSize: `${headSize}px` }, 0);
    const justEnded = round && (round.status === 'won' || round.status === 'lost') && this.lastStatus !== round.status;
    if (justEnded) {
      head.setScale(0.6);
      this.tweens.add({ targets: head, scale: 1, duration: 400, ease: 'Back.Out' });
    }
  }

  /**
   * One chip per player: icon, then "Name: score". Flows onto a second, smaller row if needed.
   * Returns how many rows it used.
   */
  private renderPlayerChips(round: RoundState | null): number {
    const scores = net.scores();
    const labels = net.playerList().map((p) => {
      const turn = round?.status === 'guessing' && round.turnId === p.id;
      const mark = round?.chooserId === p.id ? '✎ ' : turn ? '▶ ' : '';
      const you = p.id === net.me() ? ' (you)' : '';
      return { player: p, text: `${mark}${p.name}${you}: ${scores[p.id] ?? 0}` };
    });
    const joining = net.joiningCount();

    const left = 56;
    const right = WIDTH - 56;
    const sizes = [
      { icon: 34, font: 20, rows: [BOX_Y + 74] },
      { icon: 26, font: 17, rows: [BOX_Y + 52, BOX_Y + 82] },
    ];
    for (const [i, size] of sizes.entries()) {
      const placed = flowChips(labels, size.icon, size.font, left, right, size.rows.length, joining);
      if (placed.overflow > 0 && i < sizes.length - 1) continue;

      for (const chip of placed.chips) {
        const y = size.rows[chip.row];
        this.avatar(chip.x + size.icon / 2, y, size.icon, chip.player);
        const t = this.text(chip.x + size.icon + 7, y, chip.text, { fontFamily: SANS, fontSize: `${size.font}px` }, 0);
        t.setColor('#444');
      }
      const extra = [placed.overflow ? `+${placed.overflow} more` : '', joining ? `+${joining} joining…` : '']
        .filter(Boolean)
        .join('  ');
      if (extra) {
        const y = size.rows[placed.lastRow];
        this.text(placed.endX, y, extra, { fontFamily: SANS, fontSize: `${size.font}px`, color: '#777' }, 0);
      }
      return size.rows.length;
    }
    return 1;
  }

  /** A player's icon as a circle, or their initial on their colour until the image has loaded. */
  private avatar(x: number, y: number, size: number, player: net.Player): void {
    const key = this.avatarTexture(player.photo);
    if (key) {
      const img = this.add.image(x, y, key).setDisplaySize(size, size);
      this.ui.add(img);
      return;
    }
    const color = Phaser.Display.Color.HexStringToColor(player.color || '#888').color;
    const dot = this.add.circle(x, y, size / 2, color);
    this.ui.add(dot);
    const initial = (player.name.trim()[0] ?? '?').toUpperCase();
    this.text(x, y, initial, { fontFamily: SANS, fontSize: `${Math.round(size * 0.5)}px`, fontStyle: 'bold' });
  }

  /** Texture key for an avatar URL, loading it (cropped to a circle) on first use. */
  private avatarTexture(photo: string): string | null {
    if (!photo) return null;
    const known = this.avatarKeys.get(photo);
    if (known !== undefined) return known;
    this.avatarKeys.set(photo, null); // Loading (or failed): use the placeholder meanwhile.
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const px = 96;
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = px;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.beginPath();
      ctx.arc(px / 2, px / 2, px / 2, 0, Math.PI * 2);
      ctx.clip();
      ctx.drawImage(img, 0, 0, px, px);
      const key = `avatar-${this.avatarCount++}`;
      this.textures.addCanvas(key, canvas);
      this.avatarKeys.set(photo, key);
      this.lastSnapshot = ''; // Redraw with the real icon.
    };
    img.src = photo;
    return null;
  }

  private reactToChanges(round: RoundState | null): void {
    if (round && round.id === this.lastRoundId && round.wrong > this.lastWrong) {
      this.cameras.main.shake(160, 0.006);
    }
    if (round && round.status === 'won' && this.lastStatus !== 'won') this.cameras.main.flash(300, 255, 255, 255);
    // Nudge the player when it becomes their turn (phones vibrate where supported).
    const myTurnNow = !!round && round.status === 'guessing' && round.turnId === net.me();
    if (myTurnNow && !this.wasMyTurn) navigator.vibrate?.(120);
    this.wasMyTurn = myTurnNow;
    this.lastRoundId = round?.id ?? -1;
    this.lastWrong = round?.wrong ?? 0;
    this.lastStatus = round?.status ?? null;
  }
  private lastStatus: string | null = null;
  /** Avatar URL -> texture key, or null while loading / if it failed. */
  private avatarKeys = new Map<string, string | null>();
  private avatarCount = 0;
  private wasMyTurn = false;

  // ---- Actions ----------------------------------------------------------------

  private tryGuessLetter(letter: string): void {
    const round = net.round();
    if (!round || !canGuess(round, net.me())) return;
    if (!alphabet(round.danish).includes(letter) || round.guessed.includes(letter) || this.pending.has(letter)) return;
    this.pending.add(letter);
    net.guess('letter', letter);
    // If the word picker never confirms it (e.g. they're briefly offline), make the key tappable again.
    this.time.delayedCall(4000, () => this.pending.delete(letter));
  }

  private promptSecret(round: RoundState): void {
    this.promptContext = contextOf(round);
    openPrompt({
      title: 'Pick a secret word',
      hint: round.danish
        ? 'A word or short phrase. Letters A–Z and ÆØÅ, spaces and hyphens.'
        : 'A word or short phrase. Letters A–Z, spaces and hyphens.',
      placeholder: 'e.g. lighthouse',
      submitLabel: 'Hide it!',
      secret: true,
      validate: (v) => {
        const n = normalizeWord(v, round.danish);
        return n.ok ? null : n.error;
      },
      onSubmit: (v) => {
        this.promptContext = null;
        const n = normalizeWord(v, round.danish);
        if (n.ok) net.submitSecret(n.word);
      },
    });
  }

  private promptWordGuess(round: RoundState): void {
    this.promptContext = contextOf(round);
    openPrompt({
      title: 'Guess the whole word',
      hint: `Careful — a wrong guess adds a part. (${round.masked.replaceAll(HIDDEN, '_ ')})`,
      placeholder: 'Your guess',
      submitLabel: 'Guess',
      secret: false,
      validate: (v) => {
        const n = normalizeWord(v, round.danish);
        if (!n.ok) return n.error;
        return n.word.length === round.masked.length ? null : `It has ${round.masked.length} characters.`;
      },
      onSubmit: (v) => {
        this.promptContext = null;
        net.guess('word', v);
      },
    });
  }

  // ---- Helpers -------------------------------------------------------------------

  private text(x: number, y: number, s: string, style: TextStyle, originX = 0.5): Phaser.GameObjects.Text {
    const t = this.add
      .text(x, y, s, { color: '#111', ...style })
      .setOrigin(originX, 0.5)
      .setResolution(Math.min(window.devicePixelRatio || 1, 3));
    this.ui.add(t);
    return t;
  }

  private note(y: number, s: string, color = '#555'): void {
    this.text(WIDTH / 2, y, s, { fontFamily: SANS, fontSize: '22px', color, align: 'center' });
  }

  private button(
    x: number,
    y: number,
    w: number,
    label: string,
    enabled: boolean,
    onClick: () => void,
    subtle = false,
    h = 58,
  ) {
    const fill = !enabled ? 0xeeeeee : subtle ? PAPER : INK;
    const rect = this.add.rectangle(x, y, w, h, fill).setStrokeStyle(3, enabled ? INK : MUTED);
    this.ui.add(rect);
    const text = this.text(x, y, label, {
      fontFamily: SANS,
      fontSize: `${Math.round(h * 0.41)}px`,
      fontStyle: 'bold',
      color: !enabled ? '#999' : subtle ? '#111' : '#fff',
    });
    const room = w - 28;
    if (text.width > room) text.setScale(room / text.width);
    if (enabled) {
      rect
        .setInteractive({ useHandCursor: true })
        .on('pointerdown', () => rect.setScale(0.96))
        .on('pointerout', () => rect.setScale(1))
        .on('pointerup', () => {
          rect.setScale(1);
          onClick();
        });
    }
  }
}

/** Identifies the moment a prompt was opened for; it closes if the round, status or turn moves on. */
function contextOf(round: RoundState | null): string {
  return round ? `${round.id}:${round.status}:${round.turnId ?? ''}` : 'lobby';
}

type ChipLabel = { player: net.Player; text: string };
type PlacedChip = ChipLabel & { x: number; row: number };

const measureCtx = document.createElement('canvas').getContext('2d');

function textWidth(text: string, font: number): number {
  if (!measureCtx) return text.length * font * 0.55;
  measureCtx.font = `${font}px ${SANS}`;
  return measureCtx.measureText(text).width;
}

/** Lay chips out left to right, wrapping onto up to `maxRows` rows; reports how many didn't fit. */
function flowChips(
  labels: ChipLabel[],
  icon: number,
  font: number,
  left: number,
  right: number,
  maxRows: number,
  joining: number,
) {
  const gap = 22;
  // On the last row, leave room for the "+N more" / "+N joining…" note.
  const note = joining ? `+99 more  +${joining} joining…` : '+99 more';
  const reserve = textWidth(note, font) + gap;
  const chips: PlacedChip[] = [];
  let x = left;
  let row = 0;
  let overflow = 0;
  labels.forEach((label, i) => {
    if (overflow) {
      overflow++;
      return;
    }
    const w = icon + 7 + textWidth(label.text, font);
    const needsNote = i < labels.length - 1 || joining > 0;
    const limit = row === maxRows - 1 && needsNote ? right - reserve : right;
    if (x + w > limit && x > left) {
      if (row + 1 >= maxRows) {
        overflow++;
        return;
      }
      row++;
      x = left;
    }
    chips.push({ ...label, x, row });
    x += w + gap;
  });
  return { chips, overflow, endX: x, lastRow: row };
}

async function shareLink(code: string): Promise<void> {
  const url = location.href;
  try {
    if (navigator.share) await navigator.share({ title: 'Hangman', text: `Join my Hangman room ${code}`, url });
    else {
      await navigator.clipboard.writeText(url);
      alert('Invite link copied!');
    }
  } catch {
    // User cancelled the share sheet.
  }
}
