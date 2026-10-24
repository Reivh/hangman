// The game itself. Loaded only after Play is tapped (see main.ts), because Playroom reports
// a visit as soon as its code loads.
import Phaser from 'phaser';
import { connect, joinGame, myProfile } from './net/room';
import { shieldOverlays } from './ui/dom';
import { askProfile } from './ui/join';
import { GameScene, HEIGHT, WIDTH } from './scenes/GameScene';

export async function startGame(): Promise<void> {
  // Shows Playroom's lobby (room code, QR, names/avatars) and resolves once the game launches.
  const needsProfile = await connect();
  shieldOverlays();
  // Start the game straight away, even behind the join screen: if Playroom hands this player the
  // host role while they're still picking a name, the host's jobs must keep running.
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
  keepScreenOn();
  // Late joiners aren't counted as players until they've picked a name and icon.
  if (needsProfile) {
    const { name, photo } = await askProfile(myProfile());
    joinGame(name, photo);
  }
}


/**
 * Phones drop the connection when the screen turns off, so keep it on while the game is open and
 * visible. The browser releases the lock whenever the page is hidden, so ask again when it's back.
 */
function keepScreenOn(): void {
  if (!('wakeLock' in navigator)) return;
  let lock: WakeLockSentinel | null = null;
  const request = () => {
    if (document.visibilityState !== 'visible' || (lock && !lock.released)) return;
    navigator.wakeLock.request('screen').then((l) => (lock = l), () => {});
  };
  request();
  document.addEventListener('visibilitychange', request);
  // Some browsers only grant it right after a tap.
  document.addEventListener('pointerdown', request, { passive: true });
}
