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
