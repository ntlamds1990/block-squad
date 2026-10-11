import type { ClassId, Difficulty, Team } from './balance';
import type { Rng } from './rng';

export type Mat = 'stone' | 'cobble' | 'plank' | 'plank2' | 'hay' | 'log' | 'leaves' | 'roof' | 'bush' | 'well';
export type Theme = 'village' | 'forest';

export const BURNABLE: ReadonlySet<Mat> = new Set<Mat>(['plank', 'plank2', 'hay', 'log', 'leaves', 'roof', 'bush']);

export interface Tile {
  x: number;
  z: number;
  blocks: Mat[];   // stacked bottom to top; height = blocks.length
  fire: number;    // rounds of fire left, 0 = not burning
}

export interface Unit {
  id: string;
  team: Team;
  cls: ClassId;
  name: string;
  x: number;
  z: number;
  hp: number;
  maxHp: number;
  ap: number;
  cd: number;
  alive: boolean;
  guard: boolean;
  summons: number;
}

export interface GameState {
  size: number;
  theme: Theme;
  diff: Difficulty;
  tiles: Tile[][];
  units: Unit[];
  turn: number;
  phase: 'player' | 'enemy' | 'over';
  winner: Team | null;
  rng: Rng;
  nextId: number;
}

export type AttackKind = 'melee' | 'arrow' | 'bolt' | 'light' | 'hex';

export type GameEvent =
  | { t: 'step'; id: string; x: number; z: number }
  | { t: 'attack'; id: string; target: string; kind: AttackKind; hit: boolean; chance: number; overwatch?: boolean }
  | { t: 'damage'; id: string; amount: number; label: string; cause: 'hit' | 'graze' | 'ability' | 'fire' }
  | { t: 'death'; id: string }
  | { t: 'heal'; id: string; amount: number; cause: 'ability' | 'well' }
  | { t: 'blockRemoved'; x: number; z: number; mat: Mat; cause: 'blast' | 'dig' | 'smash' | 'fire' }
  | { t: 'blockAdded'; x: number; z: number; mat: Mat }
  | { t: 'fire'; x: number; z: number; on: boolean }
  | { t: 'ability'; id: string; key: string; x: number; z: number }
  | { t: 'summon'; id: string; by: string }
  | { t: 'guard'; id: string };
