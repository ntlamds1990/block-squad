import type { ItemId } from './items';
import type { ClassId, Difficulty, PathId, Team } from './balance';
import type { Rng } from './rng';

export type Mat = 'stone' | 'cobble' | 'plank' | 'plank2' | 'hay' | 'log' | 'leaves' | 'roof' | 'bush' | 'well' | 'ice';
export type Theme = 'village' | 'forest';

export const BURNABLE: ReadonlySet<Mat> = new Set<Mat>(['plank', 'plank2', 'hay', 'log', 'leaves', 'roof', 'bush']);

export interface Tile {
  x: number;
  z: number;
  blocks: Mat[];   // stacked bottom to top; height = blocks.length
  fire: number;    // rounds of fire left, 0 = not burning
  melt?: number;   // Ice Wall: rounds until the ice melts
  trap?: string;   // a Ranger's hidden Snare (the Ranger's id)
  tower?: string;  // an Architect's Watchtower (the Architect's id); heroes stand on top
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
  owner?: string;  // who placed it (Turrets, TNT)
  kills?: number;  // goblins this hero defeated this battle (for XP)
  cd2?: number;    // cooldown of the second ability
  heroId?: string; // the Barracks hero this unit is
  path?: PathId;   // promotion
  level?: number;
  frozen?: boolean;  // skips its next turn
  rooted?: boolean;  // can't move this turn
  blessed?: boolean; // next attack gets a bonus to hit
  gear?: ItemId[];    // items the hero carries (campaign and practice)
  secondWind?: boolean; // Ring of Second Wind not used yet this battle
  potion?: number;      // Healing Potion not drunk yet: hearts it heals
  potionUsed?: boolean;
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
  mode?: 'campaign' | 'practice';
  battleId?: number;
}

export type AttackKind = 'melee' | 'arrow' | 'bolt' | 'light' | 'hex' | 'frost';

export type GameEvent =
  | { t: 'step'; id: string; x: number; z: number }
  | { t: 'attack'; id: string; target: string; kind: AttackKind; hit: boolean; chance: number; overwatch?: boolean; from?: [number, number] }
  | { t: 'damage'; id: string; amount: number; label: string; cause: 'hit' | 'graze' | 'ability' | 'fire' }
  | { t: 'death'; id: string }
  | { t: 'heal'; id: string; amount: number; cause: 'ability' | 'well' }
  | { t: 'blockRemoved'; x: number; z: number; mat: Mat; cause: 'blast' | 'dig' | 'smash' | 'fire' | 'melt' }
  | { t: 'blockAdded'; x: number; z: number; mat: Mat }
  | { t: 'fire'; x: number; z: number; on: boolean }
  | { t: 'ability'; id: string; key: string; x: number; z: number }
  | { t: 'summon'; id: string; by: string }
  | { t: 'guard'; id: string }
  | { t: 'pinned'; id: string }
  | { t: 'momentum'; id: string }
  | { t: 'status'; id: string; status: 'frozen' | 'thaw' | 'rooted' | 'blessed' | 'secondWind' | 'potion' }
  | { t: 'explode'; x: number; z: number }
  | { t: 'trap'; x: number; z: number; on: boolean; sprung?: string }
  | { t: 'tower'; x: number; z: number; on: boolean };
