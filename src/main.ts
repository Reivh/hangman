// Entry point: shows the start screen first. Playroom and the game are only loaded after Play,
// since loading Playroom already reports a visit, and visits count towards the daily-user quota.
import { skipLobby } from './dev';
import { waitForPlay } from './ui/start';

async function loadFonts(): Promise<void> {
  const fonts = ['600 54px "Bodoni Moda"', '34px "Patrick Hand"'].map((f) => document.fonts.load(f));
  // Never block the game on a slow font CDN.
  await Promise.race([Promise.all(fonts), new Promise((r) => setTimeout(r, 2500))]);
}

async function boot(): Promise<void> {
  // Start downloading Phaser (the big part) while the start screen is up. It doesn't contact anyone.
  void import('phaser');
  await loadFonts();
  if (!skipLobby) await waitForPlay();
  const { startGame } = await import('./app');
  await startGame();
}

boot();
