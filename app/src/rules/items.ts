// Gear and loot: every item in the game, what it does, and loot-chest odds. Numbers live here.
import type { AbilityDef, ClassDef, Difficulty, HeroClass } from './balance';

export type GearSlot = 'weapon' | 'armour' | 'charm';
export type Rarity = 'common' | 'rare' | 'epic';

export interface ItemMod {
  dmg?: number;          // + damage on basic attacks
  aim?: number;          // + hit chance
  move?: number;         // + tiles per move
  range?: number;        // + range (ranged heroes only)
  hp?: number;           // + hearts
  shield?: number;       // - damage from arrows, bolts and area spells (never below 1)
  power?: number;        // + damage or healing on abilities that have an amount
  quicker?: number;      // abilities are ready this many turns sooner (never below 1)
  burnOnHit?: boolean;   // a hit sets the target's tile on fire
  freezeChance?: number; // a hit may freeze the target
  secondWind?: boolean;  // once per battle, a hit that would knock the hero out leaves 1 heart
  potion?: number;       // drunk automatically when down to 1 heart: heals this much, then it's gone
}

export interface ItemDef {
  name: string;
  slot: GearSlot;
  cls?: HeroClass;       // weapons fit one class
  rarity: Rarity;
  price: number;         // Forge price (commons) or what it sells for x2 (rare/epic)
  mod: ItemMod;
  desc: string;
}

const ITEM_TABLE = {
  // Common weapons, one per class (Forge)
  ironSword: { name: 'Iron Sword', slot: 'weapon', cls: 'knight', rarity: 'common', price: 30, mod: { dmg: 1 }, desc: '+1 damage.' },
  yewBow: { name: 'Yew Bow', slot: 'weapon', cls: 'archer', rarity: 'common', price: 30, mod: { aim: 10, range: 1 }, desc: '+10% to hit and +1 range.' },
  oakStaff: { name: 'Oak Staff', slot: 'weapon', cls: 'mage', rarity: 'common', price: 30, mod: { power: 1 }, desc: 'Spells do +1 damage.' },
  steelPick: { name: 'Steel Pickaxe', slot: 'weapon', cls: 'builder', rarity: 'common', price: 30, mod: { dmg: 1 }, desc: '+1 damage.' },
  ironMace: { name: 'Iron Mace', slot: 'weapon', cls: 'cleric', rarity: 'common', price: 30, mod: { dmg: 1 }, desc: '+1 damage.' },
  // Common armour and charms (Forge)
  leather: { name: 'Leather Armour', slot: 'armour', rarity: 'common', price: 25, mod: { hp: 1 }, desc: '+1 heart.' },
  luckyCharm: { name: 'Lucky Charm', slot: 'charm', rarity: 'common', price: 20, mod: { aim: 10 }, desc: '+10% to hit.' },
  potion: { name: 'Healing Potion', slot: 'charm', rarity: 'common', price: 10, mod: { potion: 2 }, desc: 'Drunk by itself when the hero drops to 1 heart: +2 hearts. Used up.' },
  // Rare (loot chests only)
  steelSword: { name: 'Steel Sword', slot: 'weapon', cls: 'knight', rarity: 'rare', price: 60, mod: { dmg: 1, aim: 10 }, desc: '+1 damage and +10% to hit.' },
  elvenBow: { name: 'Elven Bow', slot: 'weapon', cls: 'archer', rarity: 'rare', price: 60, mod: { dmg: 1, aim: 5 }, desc: '+1 damage and +5% to hit.' },
  crystalStaff: { name: 'Crystal Staff', slot: 'weapon', cls: 'mage', rarity: 'rare', price: 60, mod: { power: 1, aim: 10 }, desc: 'Spells do +1 damage, +10% to hit.' },
  mithrilPick: { name: 'Mithril Pickaxe', slot: 'weapon', cls: 'builder', rarity: 'rare', price: 60, mod: { dmg: 1, hp: 1 }, desc: '+1 damage and +1 heart.' },
  holyMace: { name: 'Holy Mace', slot: 'weapon', cls: 'cleric', rarity: 'rare', price: 60, mod: { dmg: 1, power: 1 }, desc: '+1 damage, heals +1.' },
  chainmail: { name: 'Chainmail', slot: 'armour', rarity: 'rare', price: 60, mod: { hp: 2 }, desc: '+2 hearts.' },
  towerShield: { name: 'Tower Shield', slot: 'armour', rarity: 'rare', price: 60, mod: { hp: 1, shield: 1 }, desc: '+1 heart and -1 damage from arrows, bolts and spells.' },
  speedBoots: { name: 'Boots of Speed', slot: 'charm', rarity: 'rare', price: 60, mod: { move: 1 }, desc: '+1 tile of movement.' },
  spellTome: { name: 'Spell Tome', slot: 'charm', rarity: 'rare', price: 60, mod: { quicker: 1 }, desc: 'Abilities are ready 1 turn sooner.' },
  bigPotion: { name: 'Greater Potion', slot: 'charm', rarity: 'rare', price: 30, mod: { potion: 4 }, desc: 'Drunk by itself when the hero drops to 1 heart: +4 hearts. Used up.' },
  // Epic (loot chests only)
  flameSword: { name: 'Flaming Sword', slot: 'weapon', cls: 'knight', rarity: 'epic', price: 120, mod: { dmg: 1, aim: 5, burnOnHit: true }, desc: '+1 damage, +5% to hit, and a hit sets the target\'s tile on fire.' },
  frostBow: { name: 'Frost Bow', slot: 'weapon', cls: 'archer', rarity: 'epic', price: 120, mod: { dmg: 1, aim: 5, freezeChance: 0.35 }, desc: '+1 damage, +5% to hit, and a hit may freeze the target (35%).' },
  stormStaff: { name: 'Staff of Storms', slot: 'weapon', cls: 'mage', rarity: 'epic', price: 120, mod: { dmg: 1, power: 1, quicker: 1 }, desc: '+1 damage, spells +1 damage and ready 1 turn sooner.' },
  thunderPick: { name: 'Thunder Pickaxe', slot: 'weapon', cls: 'builder', rarity: 'epic', price: 120, mod: { dmg: 2, aim: 5 }, desc: '+2 damage and +5% to hit.' },
  sunMace: { name: 'Sunlight Mace', slot: 'weapon', cls: 'cleric', rarity: 'epic', price: 120, mod: { dmg: 1, power: 1, quicker: 1 }, desc: '+1 damage, heals +1 and ready 1 turn sooner.' },
  dragonScale: { name: 'Dragon Scale', slot: 'armour', rarity: 'epic', price: 120, mod: { hp: 2, shield: 1 }, desc: '+2 hearts and -1 damage from arrows, bolts and spells.' },
  secondWind: { name: 'Ring of Second Wind', slot: 'charm', rarity: 'epic', price: 120, mod: { secondWind: true }, desc: 'Once per battle, a hit that would knock the hero out leaves 1 heart instead.' },
  eagleEye: { name: 'Eagle Amulet', slot: 'charm', rarity: 'epic', price: 120, mod: { aim: 15, range: 1 }, desc: '+15% to hit, and +1 range for ranged heroes.' }
} satisfies Record<string, ItemDef>;

export type ItemId = keyof typeof ITEM_TABLE;
export const ITEMS: Record<ItemId, ItemDef> = ITEM_TABLE;
export const ITEM_IDS = Object.keys(ITEMS) as ItemId[];
export const item = (id: ItemId): ItemDef => ITEMS[id];
export const isItem = (id: unknown): id is ItemId => typeof id === 'string' && id in ITEMS;

// Small picture for each item on the Barracks and Forge screens
export const ICON: Record<ItemId, string> = {
  ironSword: '🗡️', yewBow: '🏹', oakStaff: '🪄', steelPick: '⛏️', ironMace: '🔨', leather: '🦺', luckyCharm: '🍀', potion: '🧪',
  steelSword: '🗡️', elvenBow: '🏹', crystalStaff: '🔮', mithrilPick: '⛏️', holyMace: '🔨', chainmail: '🛡️', towerShield: '🛡️',
  speedBoots: '👢', spellTome: '📕', bigPotion: '⚗️', flameSword: '🔥', frostBow: '❄️', stormStaff: '⚡', thunderPick: '⚡',
  sunMace: '☀️', dragonScale: '🐉', secondWind: '💍', eagleEye: '🦅'
};
export const RARITY_LABEL: Record<Rarity, string> = { common: 'Common', rare: 'Rare', epic: 'Epic' };

export const FORGE: ItemId[] = ITEM_IDS.filter(id => ITEMS[id].rarity === 'common');
export const sellPrice = (id: ItemId) => Math.floor(ITEMS[id].price / 2);
export const fits = (id: ItemId, cls: HeroClass) => !ITEMS[id].cls || ITEMS[id].cls === cls;

export const LOOT = {
  // Chance of each rarity in a chest, by difficulty (percent)
  odds: {
    easy: { common: 70, rare: 27, epic: 3 },
    normal: { common: 50, rare: 40, epic: 10 },
    hard: { common: 30, rare: 50, epic: 20 }
  } as Record<Difficulty, Record<Rarity, number>>,
  stashMax: 20
};

// Roll one item from a chest. Weapons lean towards the classes in the squad.
export function rollChest(diff: Difficulty, rand: () => number, classes: HeroClass[] = []): ItemId {
  const odds = LOOT.odds[diff];
  let r = rand() * 100;
  const rarity: Rarity = r < odds.epic ? 'epic' : (r -= odds.epic) < odds.rare ? 'rare' : 'common';
  const pool = ITEM_IDS.filter(id => ITEMS[id].rarity === rarity && (!ITEMS[id].cls || !classes.length || classes.includes(ITEMS[id].cls!)));
  return pool[Math.floor(rand() * pool.length)];
}

// The total bonus from a set of items
export function gearMod(ids: readonly ItemId[]): Required<Pick<ItemMod, 'dmg' | 'aim' | 'move' | 'range' | 'hp' | 'shield' | 'power' | 'quicker'>> & ItemMod {
  const m = { dmg: 0, aim: 0, move: 0, range: 0, hp: 0, shield: 0, power: 0, quicker: 0 } as ReturnType<typeof gearMod>;
  for (const id of ids) {
    const g = ITEMS[id].mod;
    m.dmg += g.dmg ?? 0; m.aim += g.aim ?? 0; m.move += g.move ?? 0; m.range += g.range ?? 0;
    m.hp += g.hp ?? 0; m.shield += g.shield ?? 0; m.power += g.power ?? 0; m.quicker += g.quicker ?? 0;
    if (g.burnOnHit) m.burnOnHit = true;
    if (g.freezeChance) m.freezeChance = Math.max(m.freezeChance ?? 0, g.freezeChance);
    if (g.secondWind) m.secondWind = true;
    if (g.potion) m.potion = Math.max(m.potion ?? 0, g.potion);
  }
  return m;
}

const tuneAbility = (a: AbilityDef | undefined, m: ReturnType<typeof gearMod>): AbilityDef | undefined =>
  a && {
    ...a,
    ...(a.amount !== undefined && m.power ? { amount: a.amount + m.power } : {}),
    ...(a.cd > 1 && m.quicker ? { cd: Math.max(1, a.cd - m.quicker) } : {})
  };

// A hero's stats with their gear on
export function withGear(base: ClassDef, ids: readonly ItemId[]): ClassDef {
  const m = gearMod(ids);
  return {
    ...base,
    dmg: base.dmg + m.dmg,
    aim: base.aim + m.aim,
    move: base.move + m.move,
    range: base.range > 1 ? base.range + m.range : base.range,
    shield: (base.shield ?? 0) + m.shield || undefined,
    burnOnHit: base.burnOnHit || m.burnOnHit,
    freezeChance: Math.max(base.freezeChance ?? 0, m.freezeChance ?? 0) || undefined,
    ability: tuneAbility(base.ability, m),
    extra: tuneAbility(base.extra, m)
  };
}
