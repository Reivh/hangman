import Phaser from 'phaser';
import { connect } from './net/room';
import { GameScene, HEIGHT, WIDTH } from './scenes/GameScene';

async function loadFonts(): Promise<void> {
  const fonts = ['600 54px "Bodoni Moda"', '34px "Patrick Hand"'].map((f) => document.fonts.load(f));
  // Never block the game on a slow font CDN.
  await Promise.race([Promise.all(fonts), new Promise((r) => setTimeout(r, 2500))]);
}

async function boot(): Promise<void> {
  await loadFonts();
  // Shows Playroom's lobby (room code, QR, names/avatars) and resolves once the game launches.
  await connect();
  new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'game',
    backgroundColor: '#ffffff',
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
      width: WIDTH,
      height: HEIGHT,
    },
    scene: [GameScene],
  });
}

boot();
