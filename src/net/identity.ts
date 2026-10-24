// Keeps a player's seat (id, name, icon and so their points) when they come back to a room.
//
// Playroom keeps its player id and profile in sessionStorage, which belongs to a single tab. Opening the
// invite link again usually opens a new tab (or a chat app's in-app browser), and Playroom would make a
// brand-new player there. So we keep a copy in localStorage and hand it back to Playroom in a new tab
// that opens the same room. A Web Lock per player makes sure only one open tab is that player.
//
// No Playroom import here: main.ts uses this before Playroom is loaded.
import { GAME_NIGHT_MS, read, readObject, remove, write } from './storage';

/** Playroom's own sessionStorage keys for the player id and profile. */
const PLAYROOM_KEYS = ['myId', 'playerName', 'playerPhoto', 'playerColor'];
const SAVED_KEY = 'hangman:identity';
const SELF_KEY = 'hangman:self';

export interface Profile {
  name: string;
  photo: string;
  color: string;
}

export interface Self {
  room: string;
  /** Playroom player id this record belongs to. */
  id: string;
  /** Picked a name and icon (or was in Playroom's lobby), so counts as a player. */
  joined: boolean;
  /** Last good profile, to put back if Playroom loses it on a reconnect. */
  profile: Profile | null;
}

/** The room code from the invite link (`#r=RABCD`), or null. */
export function linkRoom(): string | null {
  const match = /[#&]r=R([A-Z0-9]+)/i.exec(location.hash);
  return match ? match[1].toUpperCase() : null;
}

/**
 * This tab was already in the linked room and is still that player, i.e. it's a reload (Playroom reloads
 * after losing the connection). False for a duplicated tab, whose player belongs to the original tab.
 */
export async function returningToLinkedRoom(): Promise<boolean> {
  const room = linkRoom();
  const self = room ? loadSelf(room, null) : null;
  return !!self && !(await heldElsewhere(self.id));
}

/** What this tab knows about its player in `room` (and with that id, if given). */
export function loadSelf(room: string, id: string | null): Self | null {
  const self = toSelf(readObject('session', SELF_KEY));
  return self && self.room === room && (id === null || self.id === id) ? self : null;
}

/**
 * Remember this tab's player, and back it up for other tabs once they've joined. A tab that hasn't
 * joined (e.g. a second tab that had to become a new player) mustn't replace a real player's backup.
 */
export function saveSelf(self: Self): void {
  write('session', SELF_KEY, JSON.stringify(self));
  if (!self.joined) return;
  const playroom: Record<string, string> = {};
  for (const key of PLAYROOM_KEYS) {
    const value = read('session', key);
    if (value !== null) playroom[key] = value;
  }
  write('local', SAVED_KEY, JSON.stringify({ self, playroom, at: Date.now() }));
}

/**
 * Must run before insertCoin(). Claims this tab's player, or, in a fresh tab opening the same room as the
 * saved identity, claims that one and gives it back to Playroom. If another open tab already is that
 * player (a duplicated tab copies sessionStorage), this tab forgets it and Playroom makes a new player.
 */
export async function adoptSavedIdentity(): Promise<void> {
  const current = read('session', 'myId');
  if (current !== null) {
    if (!(await claimPlayer(current, true))) for (const key of [...PLAYROOM_KEYS, SELF_KEY]) remove('session', key);
    return;
  }
  const room = linkRoom();
  const saved = readObject('local', SAVED_KEY);
  const self = toSelf(saved?.self);
  const playroom = saved?.playroom;
  if (!room || !saved || !self || self.room !== room || typeof playroom !== 'object' || playroom === null) return;
  if (typeof saved.at !== 'number' || Date.now() - saved.at > GAME_NIGHT_MS) return;
  const values = playroom as Record<string, unknown>;
  if (values.myId !== self.id) return;
  // Without Web Locks we can't tell whether another tab is this player, so don't risk it.
  if (!(await claimPlayer(self.id, false))) return;
  for (const key of PLAYROOM_KEYS) {
    const value = values[key];
    if (typeof value === 'string') write('session', key, value);
  }
  write('session', SELF_KEY, JSON.stringify(self));
}

/** Mark this player as taken by this tab for as long as it's open (if adoptSavedIdentity didn't already). */
export function holdPlayer(id: string): void {
  void claimPlayer(id, true);
}

const lockName = (id: string): string => `hangman:player:${id}`;
const claimed = new Set<string>();

/**
 * Take the player's lock and keep it while this tab is open; false if another tab has it. Checking and
 * taking happen in one step, so two tabs opened at once can't both become the same player.
 */
function claimPlayer(id: string, withoutLocks: boolean): Promise<boolean> {
  if (claimed.has(id)) return Promise.resolve(true);
  if (!('locks' in navigator)) return Promise.resolve(withoutLocks);
  return new Promise((resolve) => {
    navigator.locks
      .request(lockName(id), { ifAvailable: true }, (lock) => {
        if (!lock) {
          resolve(false);
          return;
        }
        claimed.add(id);
        resolve(true);
        return new Promise<void>(() => {}); // Never settles, so the lock is held until the tab closes.
      })
      .catch(() => resolve(withoutLocks));
  });
}

async function heldElsewhere(id: string): Promise<boolean> {
  if (!('locks' in navigator)) return false;
  try {
    const { held = [] } = await navigator.locks.query();
    return held.some((lock) => lock.name === lockName(id));
  } catch {
    return false;
  }
}

function toSelf(value: unknown): Self | null {
  if (typeof value !== 'object' || value === null) return null;
  const { room, id, joined, profile } = value as Record<string, unknown>;
  if (typeof room !== 'string' || typeof id !== 'string' || typeof joined !== 'boolean') return null;
  return { room, id, joined, profile: toProfile(profile) };
}

function toProfile(value: unknown): Profile | null {
  if (typeof value !== 'object' || value === null) return null;
  const { name, photo, color } = value as Record<string, unknown>;
  return typeof name === 'string' && typeof photo === 'string' && typeof color === 'string'
    ? { name, photo, color }
    : null;
}
