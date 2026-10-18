// Heroes that grow: the Barracks of saved heroes, XP and levels, promotions, gold, recruits and
// the Fallen Heroes wall. Pure data and rules, no screen code. A knocked-out hero is gone for good.
import { CLASSES, HERO_CLASSES, NAME_POOL, PATHS, PATHS_OF, PROGRESS, type HeroClass, type PathId } from './balance';
import { living, type SquadMember } from './game';
import type { GameState, Theme } from './types';
import { FORGE, ITEMS, LOOT, fits, isItem, rollChest, sellPrice, type GearSlot, type ItemId } from './items';

export interface HeroRecord {
  id: string;
  name: string;
  cls: HeroClass;
  path?: PathId;
  xp: number;
  kills: number;
  battles: number;
  gear?: Partial<Record<GearSlot, ItemId>>;
}

export interface FallenRecord {
  name: string;
  cls: HeroClass;
  path?: PathId;
  level: number;
  kills: number;
  battles: number;
  place: string;  // where they fell, e.g. "the Dark Forest"
  battle: number; // which battle of the campaign
}

export interface Campaign {
  v: 1;
  gold: number;
  heroes: HeroRecord[];
  fallen: FallenRecord[];
  battles: number;
  wins: number;
  nextId: number;
  squad: string[];        // hero ids picked for the next battle
  stash: ItemId[];        // items nobody is carrying
  lastBattle?: number;    // battleId of the last result applied (so a result is never counted twice)
}

export interface HeroReport {
  id: string;
  name: string;
  xp: number;            // XP earned this battle
  levelBefore: number;
  levelAfter: number;
  kills: number;
  fell: boolean;
  canPromote: boolean;
}

export interface BattleReport {
  won: boolean;
  gold: number;
  goblins: number;       // goblins defeated
  heroes: HeroReport[];
  freeRecruits: string[];
  loot?: ItemId;         // the chest from a win
  lootSold?: number;     // gold, when the stash was full and the chest's item was sold
  gearBack: ItemId[];    // a fallen hero's gear, carried home after a win
  gearLost: ItemId[];    // a fallen hero's gear, lost in a defeat
  potions: string[];     // heroes who drank their potion
}

export function levelOf(xp: number): number {
  let lvl = 1;
  PROGRESS.levelXp.forEach((need, i) => { if (xp >= need) lvl = i + 1; });
  return lvl;
}
// XP needed for the next level, or null at the top level
export function nextLevelXp(xp: number): number | null {
  const lvl = levelOf(xp);
  return PROGRESS.levelXp[lvl] ?? null;
}
export const canPromote = (h: HeroRecord) => !h.path && levelOf(h.xp) >= PROGRESS.promoteAt;
export const heroLabel = (h: { cls: HeroClass; path?: PathId }) => (h.path ? PATHS[h.path].label : CLASSES[h.cls].label);

function pickName(cls: HeroClass, taken: string[], rand: () => number): string {
  const pool = NAME_POOL[cls].filter(n => !taken.includes(n));
  const list = pool.length ? pool : NAME_POOL[cls];
  const base = list[Math.floor(rand() * list.length)];
  if (!taken.includes(base)) return base;
  for (let i = 2; ; i++) if (!taken.includes(`${base} ${i}`)) return `${base} ${i}`;
}

function addHero(c: Campaign, cls: HeroClass, name: string): HeroRecord {
  const h: HeroRecord = { id: 'r' + c.nextId++, name, cls, xp: 0, kills: 0, battles: 0 };
  c.heroes.push(h);
  return h;
}

// A new Barracks: 6 heroes, starting with the squad the player already built (if any)
export function newCampaign(start: { cls: HeroClass; name: string }[] = [], rand: () => number = Math.random): Campaign {
  const c: Campaign = { v: 1, gold: PROGRESS.gold.start, heroes: [], fallen: [], battles: 0, wins: 0, nextId: 1, squad: [], stash: [] };
  for (const m of start.slice(0, PROGRESS.startRoster)) addHero(c, m.cls, m.name.trim().slice(0, 14) || pickName(m.cls, [], rand));
  // Fill up with the classes not picked yet, then Knights and Archers
  const order: HeroClass[] = [...HERO_CLASSES.filter(k => !c.heroes.some(h => h.cls === k)), 'knight', 'archer', 'mage', 'cleric'];
  for (const cls of order) {
    if (c.heroes.length >= PROGRESS.startRoster) break;
    addHero(c, cls, pickName(cls, c.heroes.map(h => h.name), rand));
  }
  c.squad = c.heroes.slice(0, PROGRESS.squadSize).map(h => h.id);
  return c;
}

export function recruit(c: Campaign, cls: HeroClass, name: string, rand: () => number = Math.random): HeroRecord | string {
  if (c.heroes.length >= PROGRESS.maxRoster) return `The Barracks is full (${PROGRESS.maxRoster} heroes).`;
  if (c.gold < PROGRESS.recruitCost) return `You need ${PROGRESS.recruitCost} gold to recruit.`;
  c.gold -= PROGRESS.recruitCost;
  const h = addHero(c, cls, name.trim().slice(0, 14) || pickName(cls, c.heroes.map(x => x.name), rand));
  if (c.squad.length < PROGRESS.squadSize) c.squad.push(h.id);
  return h;
}

// Never stuck: with fewer than 4 heroes and not enough gold to recruit, new heroes join for free
export function ensureSquad(c: Campaign, rand: () => number = Math.random): string[] {
  const added: string[] = [];
  let i = 0;
  while (c.heroes.length < PROGRESS.squadSize && c.gold < PROGRESS.recruitCost) {
    const have = new Set(c.heroes.map(h => h.cls));
    const cls = HERO_CLASSES.find(k => !have.has(k)) ?? HERO_CLASSES[i++ % HERO_CLASSES.length];
    const h = addHero(c, cls, pickName(cls, [...c.heroes, ...c.fallen].map(x => x.name), rand));
    added.push(h.name);
  }
  // Keep the picked squad valid and full when possible
  c.squad = c.squad.filter(id => c.heroes.some(h => h.id === id)).slice(0, PROGRESS.squadSize);
  for (const h of c.heroes) {
    if (c.squad.length >= PROGRESS.squadSize) break;
    if (!c.squad.includes(h.id)) c.squad.push(h.id);
  }
  return added;
}

export function promote(c: Campaign, heroId: string, path: PathId): boolean {
  const h = c.heroes.find(x => x.id === heroId);
  if (!h || !canPromote(h) || !PATHS_OF[h.cls].includes(path)) return false;
  h.path = path;
  return true;
}

export function toggleSquad(c: Campaign, heroId: string) {
  if (c.squad.includes(heroId)) c.squad = c.squad.filter(id => id !== heroId);
  else if (c.squad.length < PROGRESS.squadSize && c.heroes.some(h => h.id === heroId)) c.squad.push(heroId);
}

export function squadMembers(c: Campaign): SquadMember[] {
  return c.squad.map(id => c.heroes.find(h => h.id === id)).filter((h): h is HeroRecord => !!h)
    .map(h => ({ cls: h.cls, name: h.name, path: h.path, level: levelOf(h.xp), heroId: h.id, gear: gearList(h) }));
}

export const placeName = (t: Theme) => (t === 'forest' ? 'the Dark Forest' : 'the village');

// After a campaign battle: XP for survivors, the fallen go on the wall, and gold for the Barracks
// In co-op, `player` picks out this phone's heroes: each player's own Barracks gets its own results.
export function applyBattle(c: Campaign, s: GameState, rand: () => number = Math.random, player?: number): BattleReport | null {
  if ((s.mode !== 'campaign' && s.mode !== 'coop') || s.phase !== 'over' || (s.battleId !== undefined && c.lastBattle === s.battleId)) return null;
  c.lastBattle = s.battleId;
  const won = s.winner === 'hero';
  const goblins = s.units.filter(u => u.team === 'gob' && !u.alive).length;
  const gold = won ? PROGRESS.gold.win + goblins * PROGRESS.gold.perGoblin : PROGRESS.gold.loss;
  c.gold += gold;
  c.battles++;
  if (won) c.wins++;
  const heroes: HeroReport[] = [];
  const gearBack: ItemId[] = [], gearLost: ItemId[] = [], potions: string[] = [];
  for (const u of s.units) {
    if (u.team !== 'hero' || !u.heroId || (s.mode === 'coop' && u.player !== player)) continue;
    const h = c.heroes.find(x => x.id === u.heroId);
    if (!h) continue;
    const kills = u.kills ?? 0;
    const before = levelOf(h.xp);
    h.battles++;
    h.kills += kills;
    if (u.potionUsed && h.gear?.charm && ITEMS[h.gear.charm].mod.potion) {
      delete h.gear.charm;
      potions.push(h.name);
    }
    if (!u.alive) {
      for (const id of gearList(h)) (won ? gearBack : gearLost).push(id);
      c.heroes = c.heroes.filter(x => x !== h);
      c.squad = c.squad.filter(id => id !== h.id);
      c.fallen.push({ name: h.name, cls: h.cls, path: h.path, level: before, kills: h.kills, battles: h.battles, place: placeName(s.theme), battle: c.battles });
      heroes.push({ id: h.id, name: h.name, xp: 0, levelBefore: before, levelAfter: before, kills, fell: true, canPromote: false });
      continue;
    }
    const xp = kills * PROGRESS.xpPerDefeat + PROGRESS.xpForSurviving;
    h.xp += xp;
    heroes.push({ id: h.id, name: h.name, xp, levelBefore: before, levelAfter: levelOf(h.xp), kills, fell: false, canPromote: canPromote(h) });
  }
  c.stash.push(...gearBack);
  let loot: ItemId | undefined, lootSold: number | undefined;
  if (won) {
    loot = rollChest(s.diff, rand, c.heroes.map(h => h.cls));
    if (c.stash.length >= LOOT.stashMax) { lootSold = sellPrice(loot); c.gold += lootSold; }
    else c.stash.push(loot);
  }
  const freeRecruits = ensureSquad(c, rand);
  return { won, gold, goblins, heroes, freeRecruits, loot, lootSold, gearBack, gearLost, potions };
}

// After a Duel: nobody is lost, and the winner's Barracks gets a little gold
export function applyDuel(c: Campaign, s: GameState, player: number): number | null {
  if (s.mode !== 'duel' || s.phase !== 'over' || !s.match || (s.battleId !== undefined && c.lastBattle === s.battleId)) return null;
  c.lastBattle = s.battleId;
  const won = s.winner === s.match.teams[player];
  if (won) c.gold += PROGRESS.gold.duelWin;
  return won ? PROGRESS.gold.duelWin : 0;
}

export function parseCampaign(json: string | null): Campaign | null {
  if (!json) return null;
  try {
    const c = JSON.parse(json);
    if (!c || c.v !== 1 || !Array.isArray(c.heroes) || !Array.isArray(c.fallen) || typeof c.gold !== 'number') return null;
    c.heroes = c.heroes.filter((h: HeroRecord) => h && HERO_CLASSES.includes(h.cls) && typeof h.name === 'string');
    for (const h of c.heroes as HeroRecord[]) {
      h.xp = Number(h.xp) || 0;
      h.kills = Number(h.kills) || 0;
      h.battles = Number(h.battles) || 0;
      if (h.path && PATHS[h.path]?.cls !== h.cls) delete h.path;
    }
    if (!Array.isArray(c.squad)) c.squad = [];
    c.stash = Array.isArray(c.stash) ? c.stash.filter(isItem) : [];
    for (const h of c.heroes as HeroRecord[]) {
      if (!h.gear || typeof h.gear !== 'object') { delete h.gear; continue; }
      for (const slot of SLOTS) {
        const id = h.gear[slot];
        if (id !== undefined && (!isItem(id) || ITEMS[id].slot !== slot || !fits(id, h.cls))) delete h.gear[slot];
      }
    }
    return c as Campaign;
  } catch {
    return null;
  }
}

/* ---------- Gear ---------- */

export const SLOTS: GearSlot[] = ['weapon', 'armour', 'charm'];
export const gearList = (h: HeroRecord): ItemId[] => SLOTS.map(sl => h.gear?.[sl]).filter((x): x is ItemId => !!x);

export function buy(c: Campaign, id: ItemId): string | null {
  if (!FORGE.includes(id)) return 'The Forge does not sell that.';
  if (c.gold < ITEMS[id].price) return `You need ${ITEMS[id].price} gold.`;
  if (c.stash.length >= LOOT.stashMax) return `Your stash is full (${LOOT.stashMax} items). Sell something first.`;
  c.gold -= ITEMS[id].price;
  c.stash.push(id);
  return null;
}

export function sell(c: Campaign, stashIndex: number): number {
  const id = c.stash[stashIndex];
  if (!id) return 0;
  c.stash.splice(stashIndex, 1);
  const g = sellPrice(id);
  c.gold += g;
  return g;
}

// Put a stash item on a hero; whatever was in that slot goes back to the stash
export function equip(c: Campaign, heroId: string, stashIndex: number): string | null {
  const h = c.heroes.find(x => x.id === heroId);
  const id = c.stash[stashIndex];
  if (!h || !id) return 'Nothing to equip.';
  if (!fits(id, h.cls)) return `${ITEMS[id].name} is for ${ITEMS[id].cls}s only.`;
  const slot = ITEMS[id].slot;
  c.stash.splice(stashIndex, 1);
  const old = h.gear?.[slot];
  if (old) c.stash.push(old);
  h.gear = { ...h.gear, [slot]: id };
  return null;
}

export function unequip(c: Campaign, heroId: string, slot: GearSlot): boolean {
  const h = c.heroes.find(x => x.id === heroId);
  const id = h?.gear?.[slot];
  if (!h || !id) return false;
  delete h.gear![slot];
  c.stash.push(id);
  return true;
}

export const survivors = (s: GameState) => living(s, 'hero').length;
