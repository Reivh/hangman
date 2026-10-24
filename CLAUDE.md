# CLAUDE.md

Multiplayer Hangman for browsers and phones: Phaser 4 + Playroom Kit + TypeScript, built with Vite and
deployed as a static site to GitHub Pages. See `README.md` for gameplay and the file layout.

## Commands

```bash
npm run dev     # dev server (also on the LAN for phones)
npx tsc         # type-check
npm test        # unit tests (vitest)
npm run build   # type-check + production build into dist/
```

Run `npx tsc` and `npm test` before committing.

## Branches

- **`develop`** is the working branch: commit and push day-to-day work here. CI (`.github/workflows/ci.yml`)
  type-checks, tests and builds it, but nothing is deployed.
- **`main`** is the live game. Every push to `main` redeploys GitHub Pages (`.github/workflows/pages.yml`),
  so only merge `develop` into `main` when asked to release, and never commit to `main` directly.

## Architecture rules

- **The secret word never enters shared state.** Playroom state is visible to every client. The word lives
  only in the word picker's browser (memory + localStorage). Guessers send guesses by RPC; the picker's
  client validates them and publishes only the masked word. The word is written to state only once the round
  has ended.
- **Who writes what:** the word picker's client owns the round during play (guesses, turns, scores). The host
  only starts rounds, ends stuck rounds, changes settings and restores returning players' `joined` flag and
  profile. Keep it that way to avoid conflicting writes.
- **Treat everything from other clients as untrusted:** RPC payloads, profile names and avatar URLs come from
  other players' browsers. Validate shape and size, render text in the canvas or via `textContent` (never as
  HTML), and only accept `data:image/` avatars.
- **Game rules stay pure:** `src/logic/` has no Playroom or Phaser imports, so it can be unit-tested. Put rule
  changes there with tests; `src/net/room.ts` is the only module that talks to Playroom (besides
  `src/net/identity.ts`, which copies Playroom's sessionStorage keys and must load before it).
- **Rendering:** `GameScene` rebuilds its UI whenever a snapshot of the shared state changes. Text input uses
  the HTML dialogs in `src/ui/` so phones get a native keyboard.

## Playroom notes

- The free plan has a small daily unique-user quota, and every new browser or device counts as a user. The
  registered gameId is therefore only used in production builds (`import.meta.env.PROD`); the dev server runs
  Playroom in dev mode. Never test against the production gameId, and never commit it to source; the live
  build gets it from the `VITE_PLAYROOM_GAME_ID` repository variable.
- Merely loading the Playroom module reports a visit, so `src/main.ts` shows a start screen and only imports
  the game (and Playroom) after Play is tapped. Don't add static imports of Playroom to the entry chunk.
- `getParticipants()` returns an array at runtime despite its `Record` type; read ids from the players.
- Don't call `getProfile()` on other players: it converts their colour and throws if a client wrote a
  non-string. Read the raw `profile` state and validate each field (see `src/net/room.ts`).
- Playroom keeps the player id and profile in sessionStorage (one tab). `src/net/identity.ts` backs them up in
  localStorage so reopening the invite link in a new tab keeps the same player; a Web Lock stops two open
  tabs from becoming the same player. A reload skips the start screen.
- After a dropped connection the host recreates a player's state empty, and the player's own client doesn't
  resend unchanged values, so the host puts back `joined` and the profile of anyone it has seen before
  (`restoreReturningPlayers`). Without that they show as "+1 joining" and get no turns.
- Phones drop the connection when they sleep. `reconnectGracePeriod` makes the server hold a dropped player's
  seat for a minute; Playroom itself only retries a few times, then reloads the page. After the server lets
  a word picker go, the host waits another 2 minutes before ending their round (about 3 minutes in all). The game also keeps the
  screen awake with the Wake Lock API.
- Playroom's lobby only runs before launch; late joiners get our own join screen (`src/ui/join.ts`).

## Testing in a browser

- `?skiplobby` (dev only) skips the start screen, Playroom's lobby and the join screen.
- Multiplayer behaviour needs several isolated browser sessions (separate contexts/profiles), since players
  in the same session share an identity. Drive them against the dev server, not the live site.
- Check phone-sized viewports; the canvas is a fixed 720×1280 design scaled to fit.
