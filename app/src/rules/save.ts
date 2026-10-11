// Saving is just the game state as JSON: the random-number generator lives inside it, so a
// resumed game carries on exactly where it stopped.
import type { GameState } from './types';

export const SAVE_VERSION = 1;

export function serialize(s: GameState): string {
  return JSON.stringify({ v: SAVE_VERSION, s });
}

export function deserialize(json: string | null): GameState | null {
  if (!json) return null;
  try {
    const d = JSON.parse(json);
    if (!d || d.v !== SAVE_VERSION || !d.s || !Array.isArray(d.s.tiles) || !Array.isArray(d.s.units)) return null;
    return d.s as GameState;
  } catch {
    return null;
  }
}
