// Keeps a player's seat (id, name, icon and so their points) when they come back to a room.
//
// Playroom keeps its player id and profile in sessionStorage, which belongs to a single tab. Opening the
// invite link again usually opens a new tab (or a chat app's in-app browser), and Playroom would make a
// brand-new player there. So we keep a copy in localStorage and hand it back to Playroom in a new tab
// that opens the same room, unless another open tab is still that player.
//
// No Playroom import here: main.ts uses this before Playroom is loaded.

/** Playroom's own sessionStorage keys for the player id and profile. */
const PLAYROOM_KEYS = ['myId', 'playerName', 'playerPhoto', 'playerColor'];
const SAVED_KEY = 'hangman:identity';
const SELF_KEY = 'hangman:self';
/** A saved identity older than this belongs to an old game night. */
const MAX_AGE_MS = 12 * 60 * 60 * 1000;

export interface Self {
  room: string;
  /** Picked a name and icon (or was in Playroom's lobby), so counts as a player. */
  joined: boolean;
  /** Last good profile, to put back if Playroom loses it on a reconnect. */
  profile: { name: string; photo: string; color: string } | null;
}

interface Saved {
  self: Self;
  playroom: Record<string, string>;
  at: number;
}

/** The room code from the invite link (`#r=RABCD`), or null. */
export function linkRoom(): string | null {
  const match = /[#&]r=R([A-Z0-9]+)/i.exec(location.hash);
  return match ? match[1].toUpperCase() : null;
}

/** This tab was already in the linked room, i.e. it's a reload (Playroom reloads after losing the connection). */
export function wasInLinkedRoom(): boolean {
  const room = linkRoom();
  return !!room && loadSelf(room) !== null;
}

/** What this tab knows about its player in `room`. */
export function loadSelf(room: string): Self | null {
  const self = parse<Self>(read(sessionStorage, SELF_KEY));
  return self?.room === room ? self : null;
}

/** Remember this tab's player, and back it up for other tabs. Call when it changes. */
export function saveSelf(self: Self): void {
  write(sessionStorage, SELF_KEY, JSON.stringify(self));
  const playroom: Record<string, string> = {};
  for (const key of PLAYROOM_KEYS) {
    const value = read(sessionStorage, key);
    if (value !== null) playroom[key] = value;
  }
  write(localStorage, SAVED_KEY, JSON.stringify({ self, playroom, at: Date.now() } satisfies Saved));
}

/**
 * In a fresh tab opening the same room as the saved identity, give Playroom that identity back.
 * Must run before insertCoin(). Skipped when another tab still holds that player (see holdPlayer).
 */
export async function adoptSavedIdentity(): Promise<void> {
  const room = linkRoom();
  if (!room || read(sessionStorage, 'myId') !== null) return; // New room, or this tab already has an id.
  const saved = parse<Saved>(read(localStorage, SAVED_KEY));
  const id = saved?.playroom.myId;
  if (!saved || !id || saved.self?.room !== room || Date.now() - saved.at > MAX_AGE_MS) return;
  if (!('locks' in navigator)) return; // Can't tell whether another tab is this player, so don't risk it.
  const { held = [] } = await navigator.locks.query();
  if (held.some((lock) => lock.name === lockName(id))) return;
  for (const [key, value] of Object.entries(saved.playroom)) write(sessionStorage, key, value);
  write(sessionStorage, SELF_KEY, JSON.stringify(saved.self));
}

/** Mark this player as taken by this tab for as long as it's open. */
export function holdPlayer(id: string): void {
  if ('locks' in navigator) void navigator.locks.request(lockName(id), () => new Promise<void>(() => {}));
}

const lockName = (id: string): string => `hangman:player:${id}`;

function parse<T>(json: string | null): T | null {
  try {
    const value: unknown = json ? JSON.parse(json) : null;
    return typeof value === 'object' && value !== null ? (value as T) : null;
  } catch {
    return null;
  }
}

/** Storage can throw in private mode or embedded webviews; the game works without it. */
function read(storage: Storage, key: string): string | null {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function write(storage: Storage, key: string, value: string): void {
  try {
    storage.setItem(key, value);
  } catch {
    // Ignore: the player just won't be restored.
  }
}
