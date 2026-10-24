export const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

/** HTML overlays drawn over the canvas. */
const OVERLAYS = ['prompt', 'join', 'start'];
/** Taps on the canvas are ignored for this long after an overlay closes. */
const AFTER_CLOSE_MS = 300;
let overlayClosedAt = -Infinity;

/**
 * Phaser listens for touch and mouse releases on the whole window (to notice releases outside the
 * canvas) and hit-tests them against the game, so tapping a dialog button would also press whatever
 * key or button is drawn behind it. Keep those events inside the overlays. Buttons still work, since
 * they act on `click`.
 */
export function shieldOverlays(): void {
  for (const id of OVERLAYS) {
    for (const type of ['touchstart', 'touchend', 'mousedown', 'mouseup']) {
      $(id).addEventListener(type, (e) => e.stopPropagation());
    }
  }
}

export function noteOverlayClosed(): void {
  overlayClosedAt = performance.now();
}

/** Whether canvas taps should be ignored: an overlay is open, or has only just closed. */
export function canvasInputBlocked(): boolean {
  return OVERLAYS.some((id) => !$(id).hidden) || performance.now() - overlayClosedAt < AFTER_CLOSE_MS;
}
