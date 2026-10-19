# The Hangman

Multiplayer Hangman for friends, in the browser or on a phone. Built with **Phaser 4**, **Playroom Kit** and **TypeScript** (Vite).

## How to play

1. One person opens the game and gets a room. Others join via the room code / QR code / invite link.
   Anyone joining after the game has launched gets a short join screen to pick a name and icon (the same
   default Multiavatar icons Playroom uses). They're counted as a player once they've picked.
2. The host taps **Start game**. Players take turns being the **word picker** (rotating each round).
   If a round gets stuck, the host can end it with **End round** (top right; asks first).
3. The picker types a secret word or short phrase. Only they can see it.
4. Everyone else guesses letters (tap the on-screen keys or use a keyboard). With **2 or more guessers it's
   turn-based**: one guess each (letter or whole word), then the turn passes on, whether it was right or wrong.
   You can **Pass** your turn (no penalty), and the picker can skip someone's turn if they've wandered off. With a single guesser there are no turns.
   Every wrong letter adds a part: base, pole, beam, brace, rope, head, body, arms, legs. That's **11 misses**.
5. Guessers win if they reveal the word before the man is hung. You can also guess the whole word, but a wrong guess costs a part.

**Scoring:** +1 for each letter you reveal, +3 for solving it, and the picker gets +3 if he hangs.
The host can turn on **Danish letters (ÆØÅ)** in the lobby.

### Keeping the word secret

Playroom's shared state is visible to every client, so the word is **never** put there. It stays only in the
picker's browser. Guesses are sent by RPC, and the picker's client checks them and publishes just the masked word
(`_ A N _`). The full word is only shared once the round ends. If the picker leaves, the host's client ends the round.

## Development

```bash
npm install
npm run dev        # http://localhost:5173, also on your LAN IP so phones on the same Wi-Fi can join
npm test           # rules unit tests (vitest)
npm run build      # type-check + production build into dist/
```

Opening the page shows a start screen; nothing from Playroom loads until **Play** is tapped, so link previews and
casual visitors don't count towards Playroom's daily-user quota. The page also asks search engines not to index it.

Dev-only shortcut: `http://localhost:5173/?skiplobby` skips the start screen, Playroom's lobby and the join screen.

Optional: register the game at <https://dev.joinplayroom.com> and put its id in `.env.local` as
`VITE_PLAYROOM_GAME_ID=...` (see `.env.example`).

## Deploying

The game is published to **GitHub Pages** at <https://reivh.github.io/hangman/>. Every push to `main` runs the tests,
builds, and redeploys (`.github/workflows/pages.yml`).

`npm run build` creates a static site in `dist/` (relative paths), so it can also be hosted anywhere else
(Netlify, Vercel, itch.io…). Playroom handles the multiplayer networking, so there's no server to run.

## Layout

| Path | What |
| --- | --- |
| `src/logic/hangman.ts` | Pure rules: normalising words, masking, applying guesses, win/lose, points |
| `src/net/room.ts` | Playroom glue: lobby, shared state, RPC, who's allowed to do what |
| `src/scenes/GameScene.ts` | Phaser scene: renders lobby / choosing / guessing / results |
| `src/scenes/wordLayout.ts` | Fits the hidden word on screen (line wrapping, letter size) |
| `src/draw/gallows.ts` | The gallows drawing (dotted outline, filled in on each miss) |
| `src/ui/prompt.ts` | HTML input dialog (native phone keyboard) for words |
| `src/ui/join.ts`, `src/ui/avatars.ts` | Join screen for late joiners; default-style avatars |
