import { makeRng } from '../app/src/rules/rng';
import { addUnit } from '../app/src/rules/game';
import type { ClassId, Difficulty } from '../app/src/rules/balance';
import type { GameState, Mat, Theme } from '../app/src/rules/types';

// An empty 16x16 board with no units, for hand-built test positions
export function blank(o: { theme?: Theme; diff?: Difficulty; seed?: number } = {}): GameState {
  const size = 16;
  return {
    size, theme: o.theme ?? 'village', diff: o.diff ?? 'normal',
    tiles: Array.from({ length: size }, (_, z) => Array.from({ length: size }, (_, x) => ({ x, z, blocks: [] as Mat[], fire: 0 }))),
    units: [], turn: 1, phase: 'player', winner: null, rng: makeRng(o.seed ?? 7), nextId: 1
  };
}

export function put(s: GameState, cls: ClassId, team: 'hero' | 'gob', x: number, z: number, hp?: number) {
  const u = addUnit(s, cls, team, [x, z], undefined, hp);
  u.ap = 2;
  return u;
}

export function wall(s: GameState, x: number, z: number, ...mats: Mat[]) {
  s.tiles[z][x].blocks = mats.length ? mats : ['stone', 'stone'];
}
