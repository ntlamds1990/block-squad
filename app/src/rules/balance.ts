// Every tunable number in the game lives here. Change balance in this file only.

export type Team = 'hero' | 'gob';
export type HeroClass = 'knight' | 'archer' | 'mage' | 'builder' | 'cleric';
export type GoblinClass = 'grunt' | 'garcher' | 'shaman' | 'troll';
export type ClassId = HeroClass | GoblinClass | 'turret';
export type AbilityKey = 'spin' | 'volley' | 'fireball' | 'build' | 'heal' | 'summon';
export type Difficulty = 'easy' | 'normal' | 'hard';

export interface AbilityDef {
  key: AbilityKey;
  name: string;
  cd: number;        // turns before it can be used again (0 = every turn)
  range?: number;
  amount?: number;   // damage or healing
  costsOneAction?: boolean; // true: uses 1 action and the hero can act again; false: ends the turn
  desc: string;
}

export interface ClassDef {
  label: string;
  team: Team;
  hp: number;
  move: number;      // tiles per move action
  range: number;     // 1 = melee (next to the target)
  dmg: number;
  aim: number;       // base hit chance in %
  weapon: string;
  smash?: boolean;   // walks through walls, destroying them
  shield?: number;   // damage taken from arrows, bolts and area spells is reduced by this (never below 1)
  charge?: { move: number; dmg: number }; // extra tiles and damage when walking then attacking
  momentum?: boolean; // defeating an enemy in melee gives back 1 action
  structure?: boolean; // a placed object: never moves, doesn't count as a hero for winning or losing
  ability?: AbilityDef;
  blurb: string;
}

export const BALANCE = {
  actionsPerTurn: 2,
  graze: 1,                 // damage on a miss
  coverPenalty: { half: 25, full: 45 },
  openShotBonus: 10,        // ranged shots at a target with no cover
  longRange: { from: 5, penaltyPerTile: 5 },
  chanceLimits: { min: 10, max: 95 },
  overwatchPenalty: 15,
  overwatchStopChance: 0.5, // chance an Overwatch hit stops the target's move
  sight: { forestHero: 4.5, forestGoblin: 6 },
  fire: { groundRounds: 2, blockRounds: 3, spreadChance: 0.35, burnDamage: 1 },
  well: { heal: 1 },
  troll: { wallStepCost: 2 },
  shaman: { maxSummons: 2, summonHp: 2 },
  turret: { range: 2 }, // Builder places a turret on a tile up to this far away (1 = next to them)
  difficulty: {
    easy: { goblinHpBonus: 0, goblinAim: 0, aiNoise: 3, roster: ['grunt', 'grunt', 'grunt', 'garcher', 'garcher', 'shaman'] as GoblinClass[] },
    normal: { goblinHpBonus: 0, goblinAim: -4, aiNoise: 1.4, roster: ['grunt', 'grunt', 'grunt', 'grunt', 'garcher', 'garcher', 'shaman', 'troll'] as GoblinClass[] },
    hard: { goblinHpBonus: 0, goblinAim: -3, aiNoise: 0.3, roster: ['grunt', 'grunt', 'grunt', 'grunt', 'garcher', 'garcher', 'garcher', 'shaman', 'troll'] as GoblinClass[] }
  } as Record<Difficulty, { goblinHpBonus: number; goblinAim: number; aiNoise: number; roster: GoblinClass[] }>
};

export const CLASSES = {
  knight: {
    label: 'Knight', team: 'hero', hp: 6, move: 4, range: 1, dmg: 3, aim: 90, weapon: 'Sword',
    shield: 1, charge: { move: 1, dmg: 1 }, momentum: true,
    blurb: 'Tough front-liner. Shield blocks 1 damage from arrows and spells. Charge: walks 1 extra tile and hits +1 harder when walking then attacking. A melee defeat gives back 1 action.',
    ability: { key: 'spin', name: 'Spin Attack', cd: 3, amount: 3, desc: 'Spins and hits every goblin right next to the Knight for 3 damage. It never misses, and defeating a goblin gives back 1 action.' }
  },
  archer: {
    label: 'Archer', team: 'hero', hp: 4, move: 5, range: 7, dmg: 2, aim: 85, weapon: 'Bow',
    blurb: 'Long-range shots. Best behind cover.',
    ability: { key: 'volley', name: 'Volley', cd: 3, range: 7, amount: 1, desc: 'Rains arrows on a 3x3 area: 1 damage to every goblin there. Never misses.' }
  },
  mage: {
    label: 'Mage', team: 'hero', hp: 3, move: 4, range: 5, dmg: 2, aim: 80, weapon: 'Firebolt',
    blurb: 'Fragile, but Fireball blasts blocks and sets fires.',
    ability: { key: 'fireball', name: 'Fireball', cd: 3, range: 5, amount: 2, desc: '2 damage to every goblin in a 3x3 area. Blows up the blocks there and sets the ground and nearby wood and hay on fire.' }
  },
  builder: {
    label: 'Builder', team: 'hero', hp: 5, move: 5, range: 1, dmg: 3, aim: 85, weapon: 'Pickaxe',
    momentum: true,
    blurb: 'Builds tall walls in one go, digs them out, and sets up a crossbow Turret. A melee defeat gives back 1 action.',
    ability: { key: 'build', name: 'Build', cd: 0, costsOneAction: true, desc: 'Puts up a tall stone wall next to the Builder (full cover). Costs 1 action.' }
  },
  cleric: {
    label: 'Cleric', team: 'hero', hp: 4, move: 4, range: 4, dmg: 1, aim: 80, weapon: 'Holy light',
    blurb: 'Heals friends and keeps the squad standing.',
    ability: { key: 'heal', name: 'Heal', cd: 2, range: 4, amount: 2, desc: 'Restores 2 hearts to a hero within 4 tiles, including the Cleric. Ends the turn.' }
  },
  grunt: { label: 'Goblin', team: 'gob', hp: 3, move: 4, range: 1, dmg: 2, aim: 75, weapon: 'Club', blurb: 'Charges in with a club.' },
  garcher: { label: 'Goblin Archer', team: 'gob', hp: 2, move: 4, range: 6, dmg: 2, aim: 65, weapon: 'Bow', blurb: 'Shoots from a distance.' },
  shaman: {
    label: 'Goblin Shaman', team: 'gob', hp: 3, move: 4, range: 5, dmg: 1, aim: 70, weapon: 'Hex', blurb: 'Heals goblins and summons more.',
    ability: { key: 'summon', name: 'Summon', cd: 4, desc: 'Summons a small goblin next to the Shaman. The Shaman also heals wounded goblins for 2.' }
  },
  troll: { label: 'Troll', team: 'gob', hp: 7, move: 3, range: 1, dmg: 3, aim: 70, weapon: 'Fists', smash: true, blurb: 'Huge and slow. Smashes straight through walls.' }
} as Record<ClassId, ClassDef>;

// Placed by the Builder. Shoots the best goblin target at the end of each of your turns.
CLASSES.turret = {
  label: 'Turret', team: 'hero', hp: 3, move: 0, range: 5, dmg: 1, aim: 80, weapon: 'Crossbow', structure: true,
  blurb: 'Fires at a goblin at the end of each of your turns.'
};

export const HERO_CLASSES: HeroClass[] = ['knight', 'archer', 'mage', 'builder', 'cleric'];

export const NAME_POOL: Record<HeroClass, string[]> = {
  knight: ['Sir Bram', 'Dame Ivy', 'Sir Rowan', 'Dame Elsa'],
  archer: ['Wren', 'Finch', 'Robin', 'Hawk'],
  mage: ['Ember', 'Sage', 'Nova', 'Blaze'],
  builder: ['Digby', 'Brick', 'Mason', 'Cobble'],
  cleric: ['Brother Ash', 'Sister Mira', 'Father Oak', 'Mother Lark']
};

export const DEFAULT_SQUAD: { cls: HeroClass; name: string }[] = [
  { cls: 'knight', name: 'Sir Bram' },
  { cls: 'archer', name: 'Wren' },
  { cls: 'mage', name: 'Ember' },
  { cls: 'cleric', name: 'Sister Mira' }
];
