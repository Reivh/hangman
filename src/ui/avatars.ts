// Playroom's default avatars are Multiavatar characters made from a random seed. We generate
// more in the same style so late joiners can pick one, encoded the same way Playroom does.
import multiavatar from '@multiavatar/multiavatar/esm';

const randomSeed = (): string => Math.random().toString(36).slice(2, 12);

export function randomAvatar(): string {
  const svg = multiavatar(randomSeed());
  return 'data:image/svg+xml,' + encodeURIComponent(svg).replace(/'/g, '%27').replace(/"/g, '%22');
}

export function randomAvatars(count: number): string[] {
  return Array.from({ length: count }, randomAvatar);
}
