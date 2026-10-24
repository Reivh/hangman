// Join screen for players who arrive after the game has launched and so never saw Playroom's lobby.
import { randomAvatars } from './avatars';
import { $, noteOverlayClosed } from './dom';

const CHOICES = 8;

export function askProfile(current: { name: string; photo: string }): Promise<{ name: string; photo: string }> {
  const overlay = $('join');
  const form = $<HTMLFormElement>('join-form');
  const nameInput = $<HTMLInputElement>('join-name');
  const grid = $('join-avatars');
  const error = $('join-error');

  let selected = current.photo;

  const renderChoices = (photos: string[]) => {
    grid.replaceChildren(
      ...photos.map((photo, i) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.setAttribute('aria-label', `Icon ${i + 1}`);
        button.setAttribute('aria-pressed', String(photo === selected));
        const img = document.createElement('img');
        img.src = photo;
        img.alt = '';
        button.append(img);
        button.onclick = () => {
          selected = photo;
          for (const b of grid.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b === button));
        };
        return button;
      }),
    );
  };

  // Keep the icon Playroom already gave them as the first choice.
  const first = current.photo ? [current.photo] : [];
  const initial = [...first, ...randomAvatars(CHOICES - first.length)];
  if (!selected) selected = initial[0];
  renderChoices(initial);
  $('join-shuffle').onclick = () => renderChoices([selected, ...randomAvatars(CHOICES - 1)]);

  nameInput.value = current.name;
  overlay.hidden = false;
  setTimeout(() => nameInput.focus(), 50);

  return new Promise((resolve) => {
    form.onsubmit = (e) => {
      e.preventDefault();
      const name = nameInput.value.trim();
      if (!name) {
        error.textContent = 'Type a name so your friends know who you are.';
        return;
      }
      overlay.hidden = true;
      noteOverlayClosed();
      nameInput.blur();
      resolve({ name, photo: selected });
    };
  });
}
