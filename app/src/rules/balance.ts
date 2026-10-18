// Every tunable number in the game lives here. Change balance in this file only.

export type Team = 'hero' | 'gob';
export type HeroClass = 'knight' | 'archer' | 'mage' | 'builder' | 'cleric';
export type GoblinClass = 'grunt' | 'garcher' | 'shaman' | 'troll';
export type ClassId = HeroClass | GoblinClass | 'turret' | 'tnt';
export type AbilityKey = 'spin' | 'volley' | 'fireball' | 'build' | 'heal' | 'summon' | 'turret'
  | 'layOnHands' | 'aimedShot' | 'snare' | 'iceWall' | 'tnt' | 'tower' | 'vines' | 'blizzard';
export type PathId = 'paladin' | 'berserker' | 'sharpshooter' | 'ranger' | 'pyromancer' | 'frostmage'
  | 'demolitionist' | 'architect' | 'priest' | 'druid';
export type Difficulty = 'easy' | 'normal' | 'hard';

export interface AbilityDef {
  key: AbilityKey;
  name: string;
  short?: string; // shorter label for the button bar
  cd: number;        // turns before it can be used again (0 = every turn)
  range?: number;
  amount?: number;   // damage or healing
  costsOneAction?: boolean; // true: uses 1 action and the hero can act again; false: ends the turn
  wide?: boolean;    // Build puts up 2 blocks side by side
  aimBonus?: number; // Aimed Shot: extra hit chance
  mult?: number;     // Aimed Shot: damage multiplier
  burn?: number;     // Fireball: extra rounds the ground burns
  splash?: number;   // Heal: also heals friends next to the target
  bless?: boolean;   // Heal: the target's next attack gets a bonus to hit
  max?: number;      // most of these on the map at once (Snare, TNT, Watchtower, Turret)
  rounds?: number;   // Ice Wall: turns before the ice melts
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
  momentum?: boolean; // defeating an enemy in melee refunds the attack (the actions the hero had before it)
  structure?: boolean; // a placed object: never moves, doesn't count as a hero for winning or losing
  aura?: number;      // friends right next to this hero take this much less damage (never below 1)
  ignoresHalfCover?: boolean;
  burnOnHit?: boolean; // a hit sets the target's tile on fire
  freezeChance?: number; // a hit may freeze the target so it skips its next turn
  stealth?: boolean;  // goblins only spot this hero within 2 tiles when it is near bushes or trees, or in the forest
  ability?: AbilityDef;
  extra?: AbilityDef; // a second ability button (the Builder's Turret, and some promotions)
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
  sight: { forestHero: 4.5, forestGoblin: 5 },
  fire: { groundRounds: 2, blockRounds: 3, spreadChance: 0.35, burnDamage: 1 },
  well: { heal: 1 },
  troll: { wallStepCost: 2 },
  shaman: { maxSummons: 2, summonHp: 2 },
  turret: { range: 2 }, // Builder places a turret on a tile up to this far away (1 = next to them)
  tower: { range: 2, aim: 15, crossbowMult: 2 }, // the Watchtower's crossbow hits for 2 // a hero on a Watchtower: +2 range for ranged attacks and +15% to hit
  stealthSight: 2,
  bless: 20,
  freeze: 0.5,
  tnt: { damage: 3 },
  snare: { damage: 2 },
  // Goblins that keep up: a stronger squad (levels, promotions, gear) faces extra goblins
  adaptive: {
    perLevel: 1, promoted: 1, gear: { common: 1, rare: 1.5, epic: 2.5 },
    pointsPerGoblin: 3.5,   // squad power points for each extra goblin
    maxExtra: 9,
    extras: ['grunt', 'garcher', 'troll', 'grunt', 'shaman', 'garcher', 'troll', 'grunt', 'garcher'] as GoblinClass[]
  },
  difficulty: {
    easy: { goblinHpBonus: 0, goblinAim: 0, aiNoise: 3, roster: ['grunt', 'grunt', 'grunt', 'garcher', 'garcher', 'shaman'] as GoblinClass[] },
    normal: { goblinHpBonus: 0, goblinAim: -15, aiNoise: 1.4, roster: ['grunt', 'grunt', 'grunt', 'grunt', 'garcher', 'garcher', 'shaman', 'troll'] as GoblinClass[] },
    hard: { goblinHpBonus: 0, goblinAim: -10, aiNoise: 0.3, roster: ['grunt', 'grunt', 'grunt', 'grunt', 'garcher', 'garcher', 'garcher', 'shaman', 'troll'] as GoblinClass[] }
  } as Record<Difficulty, { goblinHpBonus: number; goblinAim: number; aiNoise: number; roster: GoblinClass[] }>
};

export const CLASSES = {
  knight: {
    label: 'Knight', team: 'hero', hp: 6, move: 4, range: 1, dmg: 3, aim: 90, weapon: 'Sword',
    shield: 1, charge: { move: 1, dmg: 1 }, momentum: true,
    blurb: 'Tough front-liner. Shield blocks 1 damage from arrows and spells. Charge: walks 1 extra tile and hits +1 harder when walking then attacking. A melee defeat refunds the attack.',
    ability: { key: 'spin', name: 'Spin Attack', cd: 3, amount: 3, desc: 'Spins and hits every goblin on the 8 tiles around the Knight for 3 damage. It never misses, and a defeat refunds the attack.' }
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
    blurb: 'Builds tall walls in one go, digs them out, and sets up a crossbow Turret. A melee defeat refunds the attack.',
    ability: { key: 'build', name: 'Build', cd: 0, costsOneAction: true, desc: 'Puts up a tall stone wall next to the Builder (full cover). Costs 1 action.' },
    extra: { key: 'turret', name: 'Turret', cd: 0, costsOneAction: true, range: 2, max: 1, desc: 'Sets up a crossbow Turret up to 2 tiles away. It has 3 hearts and shoots a goblin in range 5 at the end of each of your turns. Costs 1 action.' }
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
// Placed by the Demolitionist. Blows up at the end of the goblins' turn, or as soon as anything hits it.
CLASSES.tnt = {
  label: 'TNT', team: 'hero', hp: 1, move: 0, range: 0, dmg: 0, aim: 0, weapon: 'Fuse', structure: true,
  blurb: 'Blows up after the goblins move, or when hit: 3 damage to everyone next to it.'
};

/* ---------- Promotions: two Tier 2 paths per class, chosen at level 3 ---------- */

export interface PathDef {
  cls: HeroClass;
  label: string;
  job: string;
  blurb: string;
  mod: Partial<ClassDef>; // replaces these parts of the class
}

export const PATHS: Record<PathId, PathDef> = {
  paladin: {
    cls: 'knight', label: 'Paladin', job: 'Protector',
    blurb: '+1 heart. Friends right next to him take 1 less damage. Lay on Hands heals a friend next to him.',
    mod: {
      hp: 7, aura: 1,
      ability: { key: 'layOnHands', name: 'Lay on Hands', short: 'Lay Hands', cd: 3, amount: 2, costsOneAction: true, desc: 'Heals 2 hearts to the Paladin or a friend right next to him. Costs 1 action, so he can still attack.' }
    }
  },
  berserker: {
    cls: 'knight', label: 'Berserker', job: 'Front-line killer',
    blurb: 'Sword hits for 4. Whirlwind spins for 4 damage and is ready every 2 turns.',
    mod: {
      dmg: 4,
      ability: { key: 'spin', name: 'Whirlwind', cd: 2, amount: 4, desc: 'Spins and hits every goblin on the 8 tiles around him for 4 damage. Never misses, and a defeat refunds the attack.' }
    }
  },
  sharpshooter: {
    cls: 'archer', label: 'Sharpshooter', job: 'Long-range picks',
    blurb: 'Range 9, and low walls don\'t protect goblins from her. Aimed Shot: +25% to hit and double damage.',
    mod: {
      range: 9, ignoresHalfCover: true,
      ability: { key: 'aimedShot', name: 'Aimed Shot', cd: 3, aimBonus: 25, mult: 2, desc: 'One careful shot: +25% to hit and double damage. Ends the turn.' }
    }
  },
  ranger: {
    cls: 'archer', label: 'Ranger', job: 'Traps and ambush',
    blurb: 'Hard to spot: goblins only see her within 2 tiles when she is near bushes or trees, or anywhere in the forest. Snare: hidden traps.',
    mod: {
      stealth: true,
      ability: { key: 'snare', name: 'Snare', cd: 2, range: 3, amount: 2, max: 2, costsOneAction: true, desc: 'Hides a trap on a tile up to 3 away. The first goblin to step on it takes 2 damage and stops. Costs 1 action.' }
    }
  },
  pyromancer: {
    cls: 'mage', label: 'Pyromancer', job: 'Fire and destruction',
    blurb: 'Fireball does 3 damage and its fire burns a turn longer. Firebolt hits set the ground on fire.',
    mod: {
      burnOnHit: true,
      ability: { key: 'fireball', name: 'Fireball', cd: 3, range: 5, amount: 3, burn: 1, desc: '3 damage to every goblin in a 3x3 area. Blows up the blocks there and sets a long-burning fire.' }
    }
  },
  frostmage: {
    cls: 'mage', label: 'Frost Mage', job: 'Control',
    blurb: '+1 heart (ice armour). Blizzard freezes every goblin it hits, and Frostbolt hits may freeze too: frozen goblins skip their next turn. Ice Wall: a line of tall ice blocks.',
    mod: {
      hp: 4, weapon: 'Frostbolt', freezeChance: 0.5,
      ability: { key: 'blizzard', name: 'Blizzard', cd: 3, range: 5, amount: 2, desc: '2 damage to every goblin in a 3x3 area, and every goblin it hits is frozen and skips its next turn. Never misses. Ends the turn.' },
      extra: { key: 'iceWall', name: 'Ice Wall', cd: 3, range: 5, rounds: 3, costsOneAction: true, desc: 'Raises 3 tall ice blocks in a line (full cover) up to 5 tiles away. They melt after 3 turns. Costs 1 action.' }
    }
  },
  demolitionist: {
    cls: 'builder', label: 'Demolitionist', job: 'TNT and chain blasts',
    blurb: 'Swaps Build for TNT, which blows up after the goblins move: 3 damage around it and the walls there are gone. TNT sets off TNT. Keeps the Turret.',
    mod: {
      ability: { key: 'tnt', name: 'TNT', cd: 0, range: 3, amount: 3, max: 2, costsOneAction: true, desc: 'Places TNT up to 3 tiles away (2 at a time). It blows up after the goblins\' turn, or when anything hits it: 3 damage to everyone around it, friends too, and the blocks there are blown away. Costs 1 action.' }
    }
  },
  architect: {
    cls: 'builder', label: 'Architect', job: 'Towers and high ground',
    blurb: '+1 heart. Build puts up 2 wall blocks side by side. Watchtower: its crossbow shoots like a Turret, and a friend on top gets +2 range, +15% to hit, sees over walls and is harder to hit.',
    mod: {
      hp: 6,
      ability: { key: 'build', name: 'Build', cd: 0, costsOneAction: true, wide: true, desc: 'Puts up 2 tall stone walls side by side next to the Architect (full cover). Costs 1 action.' },
      extra: { key: 'tower', name: 'Watchtower', short: 'Tower', cd: 0, max: 1, range: 2, costsOneAction: true, desc: 'Builds a wooden Watchtower up to 2 tiles away. When nobody is on it, its crossbow shoots a goblin at the end of each of your turns, from up high. A hero on top gets +2 range and +15% to hit, sees over walls, counts as behind half cover, and goblins with clubs can\'t reach them. Trolls and fire knock it down. Costs 1 action.' }
    }
  },
  priest: {
    cls: 'cleric', label: 'Priest', job: 'Big heals',
    blurb: '+1 heart. Heal restores 3, heals 1 to friends next to the target, and blesses them: +20% to hit on their next attack.',
    mod: {
      hp: 5,
      ability: { key: 'heal', name: 'Blessed Heal', cd: 2, range: 4, amount: 3, splash: 1, bless: true, desc: 'Restores 3 hearts to a hero within 4 tiles and 1 to friends next to them. The target\'s next attack gets +20% to hit. Ends the turn.' }
    }
  },
  druid: {
    cls: 'cleric', label: 'Druid', job: 'Roots and control',
    blurb: 'Keeps Heal, and learns Vines: thorns hurt goblins in a 3x3 area and stop them moving on their next turn.',
    mod: {
      extra: { key: 'vines', name: 'Vines', cd: 3, range: 5, amount: 1, costsOneAction: true, desc: 'Thorny vines grab every goblin in a 3x3 area up to 5 tiles away: 1 damage, and they can\'t move on their next turn (they can still attack). Costs 1 action.' }
    }
  }
};

export const PATHS_OF: Record<HeroClass, [PathId, PathId]> = {
  knight: ['paladin', 'berserker'],
  archer: ['sharpshooter', 'ranger'],
  mage: ['pyromancer', 'frostmage'],
  builder: ['demolitionist', 'architect'],
  cleric: ['priest', 'druid']
};

/* ---------- Heroes that grow: XP, levels, gold and recruits ---------- */

export const PROGRESS = {
  xpPerDefeat: 1,
  xpForSurviving: 2,
  levelXp: [0, 3, 7],     // XP needed for level 1, 2 and 3
  levelHp: { 2: 1 } as Record<number, number>, // extra hearts from reaching a level
  promoteAt: 3,
  gold: { win: 30, perGoblin: 5, loss: 10, start: 0, duelWin: 20 },
  recruitCost: 25,
  maxRoster: 8,
  squadSize: 4,
  startRoster: 6
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
