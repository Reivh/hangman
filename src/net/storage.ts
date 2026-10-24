// Small, safe wrappers for browser storage. Storage can throw in private mode or embedded webviews (even
// just reading `window.localStorage`), and the game must keep working without it.

type Area = 'local' | 'session';

/** Saved state older than this belongs to an old game night. */
export const GAME_NIGHT_MS = 12 * 60 * 60 * 1000;

const area = (a: Area): Storage => (a === 'local' ? localStorage : sessionStorage);

export function read(a: Area, key: string): string | null {
  try {
    return area(a).getItem(key);
  } catch {
    return null;
  }
}

export function write(a: Area, key: string, value: string): void {
  try {
    area(a).setItem(key, value);
  } catch {
    // Ignore: whatever this was for just won't survive a reload.
  }
}

export function remove(a: Area, key: string): void {
  try {
    area(a).removeItem(key);
  } catch {
    // Ignore.
  }
}

/** A stored JSON object, or null if it's missing or not an object. Check its fields before use. */
export function readObject(a: Area, key: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(read(a, key) ?? 'null');
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}
