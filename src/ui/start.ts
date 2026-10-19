// Start screen. Nothing connects to Playroom until someone taps Play, so link previews, crawlers and
// people who just open the page don't count towards the game's daily-user quota.
import { $ } from './dom';

export function waitForPlay(): Promise<void> {
  const overlay = $('start');
  if (/[#&]r=/.test(location.hash)) {
    $('start-text').textContent = "You've been invited to a game of Hangman. Tap Play to join your friends.";
  }
  overlay.hidden = false;
  return new Promise((resolve) => {
    $('start-play').onclick = () => {
      overlay.hidden = true;
      resolve();
    };
  });
}

/** Bring the start card back with an error and a retry button, instead of leaving a blank page. */
export function showStartError(): void {
  $('start-text').textContent =
    "Something went wrong starting the game. Check your internet connection and try again. If it keeps " +
    'happening, the game may have reached its player limit for today.';
  const button = $('start-play');
  button.textContent = 'Try again';
  button.onclick = () => location.reload();
  // Cover the game (and Playroom's lobby) if they had already appeared.
  $('start').style.zIndex = '2147483647';
  $('start').hidden = false;
}
