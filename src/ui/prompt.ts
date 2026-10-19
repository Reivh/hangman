// A small HTML dialog over the canvas. Real <input> elements give phones their native keyboard.
import { MAX_WORD_LENGTH } from '../logic/hangman';
import { $ } from './dom';

export interface PromptOptions {
  title: string;
  hint: string;
  placeholder: string;
  submitLabel: string;
  /** Mask the typed text so people looking over your shoulder can't read it. */
  secret: boolean;
  /** Return an error message, or null when the value is fine. */
  validate: (value: string) => string | null;
  onSubmit: (value: string) => void;
}

let open = false;

export function isPromptOpen(): boolean {
  return open;
}

export function openPrompt(opts: PromptOptions): void {
  const overlay = $('prompt');
  const form = $<HTMLFormElement>('prompt-form');
  const input = $<HTMLInputElement>('prompt-input');
  const error = $('prompt-error');
  const reveal = $<HTMLInputElement>('prompt-reveal');

  $('prompt-title').textContent = opts.title;
  $('prompt-hint').textContent = opts.hint;
  $('prompt-submit').textContent = opts.submitLabel;
  $('prompt-reveal-row').hidden = !opts.secret;
  input.placeholder = opts.placeholder;
  input.maxLength = MAX_WORD_LENGTH;
  input.value = '';
  error.textContent = '';
  reveal.checked = false;
  input.classList.toggle('masked', opts.secret);
  reveal.onchange = () => input.classList.toggle('masked', opts.secret && !reveal.checked);

  form.onsubmit = (e) => {
    e.preventDefault();
    const problem = opts.validate(input.value);
    if (problem) {
      error.textContent = problem;
      return;
    }
    closePrompt();
    opts.onSubmit(input.value);
  };
  $('prompt-cancel').onclick = closePrompt;

  overlay.hidden = false;
  open = true;
  setTimeout(() => input.focus(), 50);
}

export function closePrompt(): void {
  $('prompt').hidden = true;
  $<HTMLInputElement>('prompt-input').blur();
  open = false;
}
