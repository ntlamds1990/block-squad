// Pure game rules: no graphics, no DOM. Every change to the game state goes through these functions,
// which return a list of events for the screen to animate. The CPU, the tests and (later) two-phone
// play all use the same rules.
import { BALANCE, CLASSES, PATHS, PROGRESS, type AbilityDef, type ClassDef, type ClassId, type Difficulty, type HeroClass, type PathId, type Team } from './balance';
import { BURNABLE, type AttackKind, type GameEvent, type GameState, type Theme, type Tile, type Unit } from './types';
import { makeRng, next, shuffle } from './rng';
import { generateLayout, layoutToTiles } from './map';
import { gearMod, withGear, type ItemId } from './items';

export const SIZE = 16;
export const N4: ReadonlyArray<readonly [number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1]];
export const key = (x: number, z: number) => x + ',' + z;

export interface SquadMember { cls: HeroClass; name: string; path?: PathId; level?: number; heroId?: string; gear?: ItemId[] }
export interface NewGameOptions { diff: Difficulty; theme: Theme; squad: SquadMember[]; seed: number; mode?: 'campaign' | 'practice' }

/* ---------- Setup ---------- */

export function createGame(o: NewGameOptions): GameState {
  const rng = makeRng(o.seed);
  const tiles = layoutToTiles(generateLayout(rng, SIZE, o.theme));
  const s: GameState = { size: SIZE, theme: o.theme, diff: o.diff, tiles, units: [], turn: 1, phase: 'player', winner: null, rng, nextId: 1, mode: o.mode, battleId: o.seed };
  const heroSpots = shuffle(rng, openSpots(s, SIZE - 3, SIZE - 1));
  o.squad.forEach((m, i) => addUnit(s, m.cls, 'hero', heroSpots[i], m.name, undefined, { path: m.path, level: m.level, heroId: m.heroId, gear: m.gear }));
  const gobSpots = shuffle(rng, openSpots(s, 0, 2));
  BALANCE.difficulty[o.diff].roster.forEach((c, i) => addUnit(s, c, 'gob', gobSpots[i]));
  startSide(s, 'hero');
  return s;
}

function openSpots(s: GameState, z0: number, z1: number): [number, number][] {
  const out: [number, number][] = [];
  for (let z = z0; z <= z1; z++) for (let x = 0; x < s.size; x++) if (!s.tiles[z][x].blocks.length) out.push([x, z]);
  return out;
}

export interface HeroExtras { path?: PathId; level?: number; heroId?: string; gear?: ItemId[] }

// Hearts for a hero: the class (or its promotion) plus any bonus from levelling up
export function heroMaxHp(c: ClassId, path?: PathId, level = 1, gear: readonly ItemId[] = []): number {
  const base = path ? PATH_DEFS[path].hp : CLASSES[c].hp;
  let bonus = gearMod(gear).hp;
  for (let l = 2; l <= level; l++) bonus += PROGRESS.levelHp[l] ?? 0;
  return base + bonus;
}

export function addUnit(s: GameState, c: ClassId, team: Team, at: [number, number], name?: string, hp?: number, x?: HeroExtras): Unit {
  const C = CLASSES[c];
  const path = x?.path && PATHS[x.path]?.cls === c ? x.path : undefined;
  const maxHp = hp ?? (team === 'gob' ? C.hp + BALANCE.difficulty[s.diff].goblinHpBonus : heroMaxHp(c, path, x?.level ?? 1, team === 'hero' ? x?.gear ?? [] : []));
  const u: Unit = {
    id: (team === 'hero' ? 'h' : 'g') + s.nextId++, team, cls: c, name: name ?? C.label,
    x: at[0], z: at[1], hp: maxHp, maxHp, ap: 0, cd: 0, cd2: 0, alive: true, guard: false, summons: 0, kills: 0
  };
  if (path) u.path = path;
  if (x?.level) u.level = x.level;
  if (x?.heroId) u.heroId = x.heroId;
  if (team === 'hero' && x?.gear?.length) {
    u.gear = [...x.gear];
    const m = gearMod(u.gear);
    if (m.secondWind) u.secondWind = true;
    if (m.potion) u.potion = m.potion;
  }
  s.units.push(u);
  return u;
}

/* ---------- Queries ---------- */

export const inside = (s: GameState, x: number, z: number) => x >= 0 && z >= 0 && x < s.size && z < s.size;
export const tileAt = (s: GameState, x: number, z: number): Tile | null => inside(s, x, z) ? s.tiles[z][x] : null;
export const hAt = (s: GameState, x: number, z: number) => inside(s, x, z) ? s.tiles[z][x].blocks.length : 0;
export const unitAt = (s: GameState, x: number, z: number) => s.units.find(u => u.alive && u.x === x && u.z === z) ?? null;
export const unitById = (s: GameState, id: string) => s.units.find(u => u.id === id) ?? null;
// Heroes and goblins that act and count for winning (placed Turrets are left out)
export const living = (s: GameState, team: Team) => s.units.filter(u => u.alive && u.team === team && !CLASSES[u.cls].structure);
export const structures = (s: GameState, team: Team) => s.units.filter(u => u.alive && u.team === team && !!CLASSES[u.cls].structure);
// Everything on the other side that can be attacked, Turrets included
export const enemiesOf = (s: GameState, u: Unit) => s.units.filter(e => e.alive && e.team !== u.team);
// A promoted hero's stats: the class with the path's changes on top
export const PATH_DEFS = Object.fromEntries(
  (Object.keys(PATHS) as PathId[]).map(p => [p, { ...CLASSES[PATHS[p].cls], ...PATHS[p].mod, label: PATHS[p].label } as ClassDef])
) as Record<PathId, ClassDef>;
const baseDef = (u: Unit): ClassDef => (u.path ? PATH_DEFS[u.path] : CLASSES[u.cls]);
// A hero's stats with their gear on, worked out once per class, path and gear combination
const GEAR_DEFS = new Map<string, ClassDef>();
export const def = (u: Unit): ClassDef => {
  if (!u.gear?.length) return baseDef(u);
  const k = (u.path ?? u.cls) + ':' + u.gear.join(',');
  let d = GEAR_DEFS.get(k);
  if (!d) GEAR_DEFS.set(k, (d = withGear(baseDef(u), u.gear)));
  return d;
};
export const classLabel = (u: Unit) => def(u).label;
export type Slot = 1 | 2;
export const abilityOf = (u: Unit, slot: Slot = 1): AbilityDef | undefined => (slot === 2 ? def(u).extra : def(u).ability);
export const cdOf = (u: Unit, slot: Slot = 1) => (slot === 2 ? u.cd2 ?? 0 : u.cd);
export const near8 = (ax: number, az: number, bx: number, bz: number) => Math.max(Math.abs(ax - bx), Math.abs(az - bz)) === 1;
export const onTower = (s: GameState, x: number, z: number) => !!tileAt(s, x, z)?.tower;
export const dist = (ax: number, az: number, bx: number, bz: number) => Math.hypot(ax - bx, az - bz);
export const adjacent = (ax: number, az: number, bx: number, bz: number) => Math.abs(ax - bx) + Math.abs(az - bz) === 1;
const hasWell = (t: Tile) => t.blocks.includes('well');

export function area3(s: GameState, x: number, z: number): [number, number][] {
  const out: [number, number][] = [];
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if (inside(s, x + dx, z + dz)) out.push([x + dx, z + dz]);
  return out;
}

// Fog in the forest: a team only sees enemies close to one of its own units
export function canSee(s: GameState, viewer: Team, u: Unit): boolean {
  if (u.team === viewer) return true;
  if (def(u).stealth && hidden(s, u)) {
    return living(s, viewer).some(v => dist(v.x, v.z, u.x, u.z) <= BALANCE.stealthSight + 0.01);
  }
  if (s.theme !== 'forest') return true;
  const r = viewer === 'hero' ? BALANCE.sight.forestHero : BALANCE.sight.forestGoblin;
  return living(s, viewer).some(v => dist(v.x, v.z, u.x, u.z) <= r + 0.01);
}
// A Ranger is hidden in the forest, or next to bushes, trees and logs
function hidden(s: GameState, u: Unit): boolean {
  if (s.theme === 'forest') return true;
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
    const t = tileAt(s, u.x + dx, u.z + dz);
    if (t && t.blocks.some(b => b === 'bush' || b === 'leaves' || b === 'log')) return true;
  }
  return false;
}

export function heroSeesTile(s: GameState, x: number, z: number): boolean {
  if (s.theme !== 'forest') return true;
  return living(s, 'hero').some(v => dist(v.x, v.z, x, z) <= BALANCE.sight.forestHero + 0.01);
}

/* ---------- Movement ---------- */

export interface PathNode { x: number; z: number; d: number; prev: PathNode | null }

// All tiles a unit can reach within `steps`. Trolls may walk through walls (not wells), at a higher cost.
export function reachFrom(s: GameState, sx: number, sz: number, steps: number, self: Unit): Map<string, PathNode> {
  const smash = !!def(self).smash;
  const out = new Map<string, PathNode>();
  const start: PathNode = { x: sx, z: sz, d: 0, prev: null };
  out.set(key(sx, sz), start);
  if (self.rooted) return out;
  const open: PathNode[] = [start];
  while (open.length) {
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (open[i].d < open[bi].d) bi = i;
    const cur = open.splice(bi, 1)[0];
    for (const [dx, dz] of N4) {
      const nx = cur.x + dx, nz = cur.z + dz;
      const t = tileAt(s, nx, nz);
      if (!t) continue;
      if (t.blocks.length && (!smash || hasWell(t))) continue;
      // Goblins can't climb a Watchtower; a Troll knocks it down
      if (t.tower && self.team === 'gob' && !smash) continue;
      const occ = unitAt(s, nx, nz);
      if (occ && occ !== self) continue;
      const d = cur.d + (t.blocks.length || (t.tower && self.team === 'gob') ? BALANCE.troll.wallStepCost : 1);
      if (d > steps) continue;
      const k = key(nx, nz);
      const old = out.get(k);
      if (old && old.d <= d) continue;
      const n: PathNode = { x: nx, z: nz, d, prev: cur };
      out.set(k, n);
      open.push(n);
    }
  }
  return out;
}
export const reach = (s: GameState, u: Unit, steps: number) => reachFrom(s, u.x, u.z, steps, u);

export function moveTiles(s: GameState, u: Unit): Map<string, PathNode> {
  if (u.ap <= 0 || u.rooted) return new Map();
  const r = reach(s, u, def(u).move);
  r.delete(key(u.x, u.z));
  return r;
}

export function pathTo(node: PathNode | null): { x: number; z: number }[] {
  const p: { x: number; z: number }[] = [];
  while (node && node.prev) { p.unshift({ x: node.x, z: node.z }); node = node.prev; }
  return p;
}

/* ---------- Line of sight, cover and hit chance ---------- */

// Tall walls block shots, except walls right next to either end (those count as cover, or leaning out)
export function los(s: GameState, ax: number, az: number, bx: number, bz: number): boolean {
  const dx = bx - ax, dz = bz - az;
  const n = Math.ceil(Math.max(Math.abs(dx), Math.abs(dz)) * 3);
  for (let i = 1; i < n; i++) {
    const t = i / n;
    const x = Math.round(ax + dx * t), z = Math.round(az + dz * t);
    if (Math.max(Math.abs(x - bx), Math.abs(z - bz)) <= 1) continue;
    if (Math.max(Math.abs(x - ax), Math.abs(z - az)) <= 1) continue;
    if (hAt(s, x, z) >= 2) return false;
  }
  return true;
}

// 0 none, 1 half (low wall), 2 full (tall wall) between the target and where the shot comes from
export function coverAt(s: GameState, tx: number, tz: number, fx: number, fz: number): number {
  const dx = fx - tx, dz = fz - tz;
  if (Math.max(Math.abs(dx), Math.abs(dz)) <= 1) return 0; // toe to toe: no cover
  const ax = Math.abs(dx), az = Math.abs(dz), sx = Math.sign(dx), sz = Math.sign(dz);
  let c = 0;
  if (sx && ax >= az * 0.5) c = Math.max(c, hAt(s, tx + sx, tz));
  if (sz && az >= ax * 0.5) c = Math.max(c, hAt(s, tx, tz + sz));
  return Math.min(c, 2);
}

// Attack range from a tile: ranged attacks reach 2 further from a Watchtower
export function rangeFrom(s: GameState, a: Unit, fx: number, fz: number): number {
  const r = def(a).range;
  return r > 1 && onTower(s, fx, fz) ? r + BALANCE.tower.range : r;
}

export function canAttackFrom(s: GameState, a: Unit, t: Unit, fx: number, fz: number): boolean {
  if (!t.alive || t.team === a.team || !canSee(s, a.team, t) || def(a).range < 1) return false;
  if (def(a).range === 1) {
    // Clubs and swords can't reach a hero up on a Watchtower (a Troll can)
    if (onTower(s, t.x, t.z) && !def(a).smash) return false;
    return near8(fx, fz, t.x, t.z); // melee reaches the 8 tiles around, diagonals too
  }
  // From a Watchtower you shoot over walls
  return dist(fx, fz, t.x, t.z) <= rangeFrom(s, a, fx, fz) + 0.01 && (onTower(s, fx, fz) || los(s, fx, fz, t.x, t.z));
}

// A Knight's shield takes 1 off damage from arrows, bolts and area spells, never below 1
export function shielded(t: Unit, dmg: number): number {
  const sh = def(t).shield ?? 0;
  return sh ? Math.max(1, dmg - sh) : dmg;
}

// A Paladin's aura: friends right next to him take 1 less damage, never below 1
export function aura(s: GameState, t: Unit, dmg: number): number {
  const p = s.units.find(o => o.alive && o !== t && o.team === t.team && (def(o).aura ?? 0) > 0 && near8(o.x, o.z, t.x, t.z));
  return p ? Math.max(1, dmg - (def(p).aura ?? 0)) : dmg;
}
// Damage from an area effect (spells, volleys, explosions) after shield and aura
export const areaDamage = (s: GameState, t: Unit, dmg: number) => aura(s, t, shielded(t, dmg));

export interface HitInfo { chance: number; cover: number; dmg: number }
export interface ShotMods { bonus?: number; mult?: number }
export function hitInfo(s: GameState, a: Unit, t: Unit, fx = a.x, fz = a.z, charging = false, mods: ShotMods = {}): HitInfo {
  const C = def(a);
  // Up on a Watchtower counts as half cover against shots
  const cover = Math.max(coverAt(s, t.x, t.z, fx, fz), C.range > 1 && onTower(s, t.x, t.z) ? 1 : 0);
  let chance = C.aim + (mods.bonus ?? 0);
  if (cover === 1 && !C.ignoresHalfCover) chance -= BALANCE.coverPenalty.half;
  if (cover === 2) chance -= BALANCE.coverPenalty.full;
  if (cover === 0 && C.range > 1) chance += BALANCE.openShotBonus;
  const d = dist(fx, fz, t.x, t.z);
  if (C.range > 1 && d > BALANCE.longRange.from) chance -= Math.round((d - BALANCE.longRange.from) * BALANCE.longRange.penaltyPerTile);
  if (C.range > 1 && onTower(s, fx, fz)) chance += BALANCE.tower.aim;
  if (a.blessed) chance += BALANCE.bless;
  if (a.team === 'gob') chance += BALANCE.difficulty[s.diff].goblinAim;
  let dmg = (C.dmg + (charging && C.charge ? C.charge.dmg : 0)) * (mods.mult ?? 1);
  if (C.range > 1) dmg = shielded(t, dmg);
  dmg = aura(s, t, dmg);
  return { chance: clampChance(chance), cover, dmg };
}
const clampChance = (c: number) => Math.max(BALANCE.chanceLimits.min, Math.min(BALANCE.chanceLimits.max, Math.round(c)));

export function attackTargets(s: GameState, u: Unit): Unit[] {
  if (u.ap <= 0) return [];
  return enemiesOf(s, u).filter(t => canAttackFrom(s, u, t, u.x, u.z));
}

// Tiles a unit can walk to before attacking with its second action (a Knight's Charge reaches 1 further)
export function moveAttackTiles(s: GameState, u: Unit): Map<string, PathNode> {
  if (u.ap < 2 || u.rooted) return new Map();
  const r = reach(s, u, def(u).move + (def(u).charge?.move ?? 0));
  r.delete(key(u.x, u.z));
  return r;
}

// Best tile to step to with one move so the unit can attack with its second action
export function moveAttackOption(s: GameState, u: Unit, t: Unit): { node: PathNode; info: HitInfo } | null {
  if (u.ap < 2) return null;
  let best: { node: PathNode; info: HitInfo; score: number } | null = null;
  moveAttackTiles(s, u).forEach(n => {
    if (tileAt(s, n.x, n.z)!.fire > 0) return;
    if (!canAttackFrom(s, u, t, n.x, n.z)) return;
    const info = hitInfo(s, u, t, n.x, n.z, true);
    const score = info.chance - n.d * 0.5;
    if (!best || score > best.score) best = { node: n, info, score };
  });
  return best;
}
export function moveAttackTargets(s: GameState, u: Unit): Unit[] {
  if (u.ap < 2) return [];
  const direct = attackTargets(s, u);
  return enemiesOf(s, u).filter(g => !direct.includes(g) && moveAttackOption(s, u, g));
}


export function digTargets(s: GameState, u: Unit): Tile[] {
  if (u.cls !== 'builder' || u.ap <= 0) return [];
  return N4.map(([dx, dz]) => tileAt(s, u.x + dx, u.z + dz)).filter((t): t is Tile => !!t && t.blocks.length > 0 && !hasWell(t));
}

// An open tile: no blocks, nobody standing there, no fire, nothing built on it
const openTile = (s: GameState, x: number, z: number) => {
  const t = tileAt(s, x, z);
  return !!t && !t.blocks.length && !t.fire && !t.tower && !t.trap && !unitAt(s, x, z);
};
const tilesWithin = (s: GameState, u: Unit, r: number, ok: (x: number, z: number) => boolean, needLos = false) => {
  const out: [number, number][] = [];
  for (let z = 0; z < s.size; z++) for (let x = 0; x < s.size; x++) {
    if (x === u.x && z === u.z) continue;
    if (dist(u.x, u.z, x, z) > r + 0.01) continue;
    if (needLos && !los(s, u.x, u.z, x, z)) continue;
    if (ok(x, z)) out.push([x, z]);
  }
  return out;
};
// How many of these things this hero has on the map now
const placed = (s: GameState, u: Unit, key: string): number => {
  if (key === 'turret' || key === 'tnt') return s.units.filter(o => o.alive && o.owner === u.id && o.cls === key).length;
  let n = 0;
  for (const row of s.tiles) for (const t of row) if ((key === 'snare' ? t.trap : t.tower) === u.id) n++;
  return n;
};

// Ice Wall: the 3 tiles across the line from the Mage to the target tile
export function iceWallCells(s: GameState, u: Unit, x: number, z: number): [number, number][] {
  const along: [number, number] = Math.abs(x - u.x) >= Math.abs(z - u.z) ? [0, 1] : [1, 0];
  return [-1, 0, 1].map(k => [x + along[0] * k, z + along[1] * k] as [number, number])
    .filter(([cx, cz]) => { const t = tileAt(s, cx, cz); return !!t && !hasWell(t) && t.blocks.length < 2 && !t.tower && !unitAt(s, cx, cz); });
}

// Architect's Build: the target tile and the one beside it
export function buildCells(s: GameState, u: Unit, x: number, z: number): [number, number][] {
  const ok = (cx: number, cz: number) => { const t = tileAt(s, cx, cz); return !!t && t.blocks.length < 2 && !hasWell(t) && !t.tower && !unitAt(s, cx, cz); };
  const out: [number, number][] = [[x, z]];
  if (abilityOf(u)?.wide) {
    const px = z - u.z, pz = x - u.x; // sideways from the Builder's view
    if (ok(x + px, z + pz)) out.push([x + px, z + pz]);
    else if (ok(x - px, z - pz)) out.push([x - px, z - pz]);
  }
  return out;
}

export function abilityTargets(s: GameState, u: Unit, slot: Slot = 1): [number, number][] {
  const ab = abilityOf(u, slot);
  if (!ab) return [];
  if (ab.max && placed(s, u, ab.key) >= ab.max) return [];
  const foes = () => enemiesOf(s, u).filter(g => canSee(s, u.team, g));
  switch (ab.key) {
    case 'spin':
      return foes().some(g => near8(u.x, u.z, g.x, g.z)) ? [[u.x, u.z]] : [];
    case 'build':
      return N4.map(([dx, dz]) => [u.x + dx, u.z + dz] as [number, number])
        .filter(([x, z]) => { const t = tileAt(s, x, z); return !!t && t.blocks.length < 2 && !hasWell(t) && !t.tower && !unitAt(s, x, z); });
    case 'heal':
      return living(s, u.team).filter(a => a.hp < a.maxHp && dist(u.x, u.z, a.x, a.z) <= (ab.range ?? 4) + 0.01).map(a => [a.x, a.z]);
    case 'layOnHands':
      return living(s, u.team).filter(a => a.hp < a.maxHp && (a === u || near8(u.x, u.z, a.x, a.z))).map(a => [a.x, a.z]);
    case 'aimedShot':
      return foes().filter(g => canAttackFrom(s, u, g, u.x, u.z)).map(g => [g.x, g.z]);
    case 'summon':
      if (u.summons >= BALANCE.shaman.maxSummons) return [];
      return N4.map(([dx, dz]) => [u.x + dx, u.z + dz] as [number, number])
        .filter(([x, z]) => { const t = tileAt(s, x, z); return !!t && !t.blocks.length && !unitAt(s, x, z); });
    case 'volley':
    case 'fireball':
    case 'blizzard':
    case 'vines':
      return tilesWithin(s, u, ab.range ?? 5, () => true, true);
    case 'iceWall':
      return tilesWithin(s, u, ab.range ?? 5, (x, z) => iceWallCells(s, u, x, z).length > 0, true);
    case 'snare':
      return tilesWithin(s, u, ab.range ?? 3, (x, z) => openTile(s, x, z));
    case 'tnt':
      return tilesWithin(s, u, ab.range ?? 3, (x, z) => openTile(s, x, z));
    case 'turret': {
      const r = ab.range ?? BALANCE.turret.range;
      return tilesWithin(s, u, r, (x, z) => Math.abs(x - u.x) + Math.abs(z - u.z) <= r && openTile(s, x, z));
    }
    case 'tower': {
      const r = ab.range ?? 1;
      return tilesWithin(s, u, r, (x, z) => Math.abs(x - u.x) + Math.abs(z - u.z) <= r && openTile(s, x, z));
    }
  }
  return [];
}
// Builder: tiles where a Turret can go (one Turret per Builder at a time)
export function turretTargets(s: GameState, u: Unit): [number, number][] {
  if (u.ap <= 0 || abilityOf(u, 2)?.key !== 'turret') return [];
  return abilityTargets(s, u, 2);
}

export function abilityReady(s: GameState, u: Unit, slot: Slot = 1): boolean {
  const ab = abilityOf(u, slot);
  return !!ab && u.ap > 0 && cdOf(u, slot) <= 0 && abilityTargets(s, u, slot).length > 0;
}

export function attackKind(u: Unit): AttackKind {
  if (def(u).freezeChance) return 'frost';
  switch (u.cls) {
    case 'archer': case 'garcher': case 'turret': return 'arrow';
    case 'mage': return 'bolt';
    case 'cleric': return 'light';
    case 'shaman': return 'hex';
    default: return 'melee';
  }
}

/* ---------- State changes ---------- */

function checkWinner(s: GameState) {
  if (s.winner) return;
  if (!living(s, 'gob').length) { s.winner = 'hero'; s.phase = 'over'; }
  else if (!living(s, 'hero').length) { s.winner = 'gob'; s.phase = 'over'; }
}

type Cause = 'hit' | 'graze' | 'ability' | 'fire';
// `by` is whoever caused the damage: a defeat counts for their XP (a Turret's or TNT's for its Builder)
function damage(s: GameState, u: Unit, n: number, label: string, cause: Cause, ev: GameEvent[], by?: Unit) {
  if (!u.alive) return;
  u.hp = Math.max(0, u.hp - n);
  ev.push({ t: 'damage', id: u.id, amount: n, label, cause });
  // Getting hit by an attack or ability knocks a unit off Overwatch
  if (cause !== 'fire') u.guard = false;
  // Ring of Second Wind: once per battle, stay up with 1 heart
  if (u.hp <= 0 && u.secondWind) {
    u.secondWind = false;
    u.hp = 1;
    ev.push({ t: 'status', id: u.id, status: 'secondWind' });
  }
  // A Healing Potion is drunk by itself at 1 heart
  if (u.hp === 1 && u.potion) {
    const amount = u.potion;
    u.potion = undefined;
    u.potionUsed = true;
    ev.push({ t: 'status', id: u.id, status: 'potion' });
    heal(u, amount, 'ability', ev);
  }
  if (u.hp <= 0) {
    u.alive = false;
    u.guard = false;
    ev.push({ t: 'death', id: u.id });
    if (by) {
      const credit = by.owner ? unitById(s, by.owner) ?? by : by;
      if (credit.team !== u.team && !CLASSES[u.cls].structure) credit.kills = (credit.kills ?? 0) + 1;
    }
    if (u.cls === 'tnt') explode(s, u, ev);
    checkWinner(s);
  }
}

// TNT: 3 damage to everyone on the 9 tiles around it (TNT there goes off too), and the blocks there are blown away
function explode(s: GameState, tnt: Unit, ev: GameEvent[]) {
  ev.push({ t: 'explode', x: tnt.x, z: tnt.z });
  const cells = area3(s, tnt.x, tnt.z);
  for (const [cx, cz] of cells) {
    const t = s.tiles[cz][cx];
    while (t.blocks.length && !hasWell(t)) ev.push({ t: 'blockRemoved', x: cx, z: cz, mat: t.blocks.pop()!, cause: 'blast' });
    if (t.tower) { t.tower = undefined; ev.push({ t: 'tower', x: cx, z: cz, on: false }); }
    if (t.trap) { t.trap = undefined; ev.push({ t: 'trap', x: cx, z: cz, on: false }); }
    if (t.melt) t.melt = undefined;
  }
  const hit = s.units.filter(o => o.alive && o !== tnt && cells.some(([cx, cz]) => cx === o.x && cz === o.z));
  for (const o of hit) {
    const d = areaDamage(s, o, BALANCE.tnt.damage);
    damage(s, o, d, 'Boom -' + d, 'ability', ev, tnt);
  }
}

function heal(u: Unit, n: number, cause: 'ability' | 'well', ev: GameEvent[]) {
  const amount = Math.min(n, u.maxHp - u.hp);
  if (amount <= 0 || !u.alive) return;
  u.hp += amount;
  ev.push({ t: 'heal', id: u.id, amount, cause });
}

function resolveAttack(s: GameState, a: Unit, t: Unit, penalty: number, ev: GameEvent[], overwatch = false, charging = false, mods: ShotMods = {}): boolean {
  const info = hitInfo(s, a, t, a.x, a.z, charging, mods);
  const chance = clampChance(info.chance - penalty);
  const hit = next(s.rng) * 100 < chance;
  if (a.blessed) a.blessed = false;
  ev.push({ t: 'attack', id: a.id, target: t.id, kind: attackKind(a), hit, chance, overwatch, ...(a.id.startsWith('tw') ? { from: [a.x, a.z] as [number, number] } : {}) });
  if (hit) damage(s, t, info.dmg, '-' + info.dmg, 'hit', ev, a);
  else damage(s, t, BALANCE.graze, 'Graze -' + BALANCE.graze, 'graze', ev, a);
  const C = def(a);
  if (hit && C.burnOnHit) {
    const tile = s.tiles[t.z][t.x];
    if (!hasWell(tile)) ignite(tile, BALANCE.fire.groundRounds, ev);
  }
  if (hit && t.alive && C.freezeChance && !t.frozen && next(s.rng) < C.freezeChance) {
    t.frozen = true;
    t.guard = false;
    ev.push({ t: 'status', id: t.id, status: 'frozen' });
  }
  // A Troll's swing knocks a Watchtower down
  if (C.smash && C.range === 1) {
    const tile = s.tiles[t.z][t.x];
    if (tile.tower) { tile.tower = undefined; ev.push({ t: 'tower', x: t.x, z: t.z, on: false }); }
  }
  return hit;
}

// Momentum: a melee defeat doesn't use up the attack, so the hero gets back the actions it had
function momentum(a: Unit, t: Unit, ev: GameEvent[], apBefore: number) {
  if (t.alive || !a.alive || !def(a).momentum || def(a).range !== 1 || apBefore <= 0) return;
  a.ap = apBefore;
  ev.push({ t: 'momentum', id: a.id });
}

// Returns true when an Overwatch hit stops the mover in its tracks
function overwatchCheck(s: GameState, mover: Unit, ev: GameEvent[]): boolean {
  let stopped = false;
  for (const h of enemiesOf(s, mover)) {
    if (!h.guard || !canAttackFrom(s, h, mover, h.x, h.z)) continue;
    h.guard = false;
    const hit = resolveAttack(s, h, mover, BALANCE.overwatchPenalty, ev, true);
    if (!mover.alive) return true;
    if (hit && !stopped && next(s.rng) < BALANCE.overwatchStopChance) {
      stopped = true;
      ev.push({ t: 'pinned', id: mover.id });
    }
  }
  return stopped;
}

export function performMove(s: GameState, u: Unit, path: { x: number; z: number }[]): GameEvent[] {
  return moveAlong(s, u, path).ev;
}

function moveAlong(s: GameState, u: Unit, path: { x: number; z: number }[]): { ev: GameEvent[]; stopped: boolean } {
  const ev: GameEvent[] = [];
  let stopped = false;
  u.ap -= 1;
  u.guard = false;
  for (const st of path) {
    const t = s.tiles[st.z][st.x];
    while (t.blocks.length) ev.push({ t: 'blockRemoved', x: st.x, z: st.z, mat: t.blocks.pop()!, cause: 'smash' });
    if (t.tower && u.team === 'gob') { t.tower = undefined; ev.push({ t: 'tower', x: st.x, z: st.z, on: false }); }
    u.x = st.x; u.z = st.z;
    ev.push({ t: 'step', id: u.id, x: st.x, z: st.z });
    if (t.fire > 0) damage(s, u, BALANCE.fire.burnDamage, 'Burn -' + BALANCE.fire.burnDamage, 'fire', ev);
    if (!u.alive || s.winner) break;
    // A Ranger's Snare: damage, and the goblin stops here
    if (t.trap && u.team === 'gob') {
      const by = unitById(s, t.trap) ?? undefined;
      t.trap = undefined;
      ev.push({ t: 'trap', x: st.x, z: st.z, on: false, sprung: u.id });
      damage(s, u, BALANCE.snare.damage, 'Snared -' + BALANCE.snare.damage, 'ability', ev, by);
      stopped = true;
      break;
    }
    stopped = overwatchCheck(s, u, ev);
    if (stopped || !u.alive || s.winner) break;
  }
  return { ev, stopped };
}

export function performAttack(s: GameState, a: Unit, t: Unit): GameEvent[] {
  const ev: GameEvent[] = [];
  const before = a.ap;
  a.ap = 0;
  a.guard = false;
  resolveAttack(s, a, t, 0, ev);
  if (!s.winner) momentum(a, t, ev, before);
  return ev;
}

export function performMoveAttack(s: GameState, a: Unit, path: { x: number; z: number }[], t: Unit): GameEvent[] {
  const { ev, stopped } = moveAlong(s, a, path);
  // Stopped by Overwatch: the attack doesn't happen, and the hero keeps their last action
  if (!stopped && a.alive && t.alive && !s.winner && canAttackFrom(s, a, t, a.x, a.z)) {
    const before = a.ap;
    a.ap = 0;
    resolveAttack(s, a, t, 0, ev, false, true);
    if (!s.winner) momentum(a, t, ev, before);
  }
  return ev;
}

export function performDig(s: GameState, u: Unit, x: number, z: number): GameEvent[] {
  const t = s.tiles[z][x];
  u.ap -= 1;
  u.guard = false;
  const mat = t.blocks.pop();
  if (!t.blocks.length) t.melt = undefined;
  return mat ? [{ t: 'blockRemoved', x, z, mat, cause: 'dig' }] : [];
}

export function performGuard(_s: GameState, u: Unit): GameEvent[] {
  u.guard = true;
  u.ap = 0;
  return [{ t: 'guard', id: u.id }];
}

export function performShamanHeal(_s: GameState, u: Unit, target: Unit): GameEvent[] {
  const ev: GameEvent[] = [{ t: 'ability', id: u.id, key: 'heal', x: target.x, z: target.z }];
  u.ap = 0;
  heal(target, 2, 'ability', ev);
  return ev;
}

export function performAbility(s: GameState, u: Unit, x: number, z: number, slot: Slot = 1): GameEvent[] {
  const ab = abilityOf(u, slot)!;
  const ev: GameEvent[] = [{ t: 'ability', id: u.id, key: ab.key, x, z }];
  const apBefore = u.ap;
  if (slot === 2) u.cd2 = ab.cd; else u.cd = ab.cd;
  if (ab.costsOneAction) u.ap -= 1; else u.ap = 0;
  u.guard = false;
  const foesIn = (cells: [number, number][]) => enemiesOf(s, u).filter(g => cells.some(([cx, cz]) => cx === g.x && cz === g.z));
  switch (ab.key) {
    case 'spin': {
      const hit = enemiesOf(s, u).filter(g => near8(u.x, u.z, g.x, g.z));
      hit.forEach(g => { const d = aura(s, g, ab.amount!); damage(s, g, d, '-' + d, 'ability', ev, u); });
      const downed = hit.find(g => !g.alive && !CLASSES[g.cls].structure);
      if (downed && !s.winner) momentum(u, downed, ev, apBefore);
      break;
    }
    case 'volley':
      foesIn(area3(s, x, z)).forEach(g => { const d = areaDamage(s, g, ab.amount!); damage(s, g, d, '-' + d, 'ability', ev, u); });
      setOffTnt(s, area3(s, x, z), ev, u);
      break;
    case 'fireball': {
      const cells = area3(s, x, z);
      for (const [cx, cz] of cells) {
        const t = s.tiles[cz][cx];
        while (t.blocks.length && !hasWell(t)) ev.push({ t: 'blockRemoved', x: cx, z: cz, mat: t.blocks.pop()!, cause: 'blast' });
        t.melt = undefined;
        if (t.tower) { t.tower = undefined; ev.push({ t: 'tower', x: cx, z: cz, on: false }); }
        if (!hasWell(t)) ignite(t, BALANCE.fire.groundRounds + (ab.burn ?? 0), ev);
      }
      // Wood, hay and leaves around the blast catch fire
      for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
        if (Math.abs(dx) <= 1 && Math.abs(dz) <= 1) continue;
        const t = tileAt(s, x + dx, z + dz);
        if (t && t.blocks.length && BURNABLE.has(t.blocks[t.blocks.length - 1]) && Math.max(Math.abs(dx), Math.abs(dz)) === 2) ignite(t, BALANCE.fire.blockRounds, ev);
      }
      foesIn(cells).forEach(g => { const d = areaDamage(s, g, ab.amount!); damage(s, g, d, '-' + d, 'ability', ev, u); });
      setOffTnt(s, cells, ev, u);
      break;
    }
    case 'build': {
      // Barricade: always ends up as a tall wall (the Architect builds two side by side)
      for (const [cx, cz] of buildCells(s, u, x, z)) {
        const t = s.tiles[cz][cx];
        if (t.fire > 0) { t.fire = 0; ev.push({ t: 'fire', x: cx, z: cz, on: false }); }
        if (t.trap) { t.trap = undefined; ev.push({ t: 'trap', x: cx, z: cz, on: false }); }
        while (t.blocks.length < 2) { t.blocks.push('cobble'); ev.push({ t: 'blockAdded', x: cx, z: cz, mat: 'cobble' }); }
      }
      break;
    }
    case 'heal': {
      const target = unitAt(s, x, z);
      if (!target) break;
      heal(target, ab.amount ?? 2, 'ability', ev);
      if (ab.splash) living(s, u.team).filter(f => f !== target && near8(f.x, f.z, target.x, target.z)).forEach(f => heal(f, ab.splash!, 'ability', ev));
      if (ab.bless && !target.blessed) { target.blessed = true; ev.push({ t: 'status', id: target.id, status: 'blessed' }); }
      break;
    }
    case 'layOnHands': {
      const target = unitAt(s, x, z);
      if (target) heal(target, ab.amount ?? 2, 'ability', ev);
      break;
    }
    case 'aimedShot': {
      const target = unitAt(s, x, z);
      if (target) resolveAttack(s, u, target, 0, ev, false, false, { bonus: ab.aimBonus, mult: ab.mult });
      break;
    }
    case 'summon': {
      const imp = addUnit(s, 'grunt', u.team, [x, z], 'Goblin', BALANCE.shaman.summonHp);
      u.summons++;
      ev.push({ t: 'summon', id: imp.id, by: u.id });
      break;
    }
    case 'turret': {
      const t = addUnit(s, 'turret', u.team, [x, z], u.name + "'s Turret");
      t.owner = u.id;
      ev.push({ t: 'summon', id: t.id, by: u.id });
      break;
    }
    case 'tnt': {
      const t = addUnit(s, 'tnt', u.team, [x, z], 'TNT');
      t.owner = u.id;
      ev.push({ t: 'summon', id: t.id, by: u.id });
      break;
    }
    case 'snare':
      s.tiles[z][x].trap = u.id;
      ev.push({ t: 'trap', x, z, on: true });
      break;
    case 'tower':
      s.tiles[z][x].tower = u.id;
      ev.push({ t: 'tower', x, z, on: true });
      break;
    case 'iceWall':
      for (const [cx, cz] of iceWallCells(s, u, x, z)) {
        const t = s.tiles[cz][cx];
        if (t.fire > 0) { t.fire = 0; ev.push({ t: 'fire', x: cx, z: cz, on: false }); }
        if (t.trap) { t.trap = undefined; ev.push({ t: 'trap', x: cx, z: cz, on: false }); }
        while (t.blocks.length < 2) { t.blocks.push('ice'); ev.push({ t: 'blockAdded', x: cx, z: cz, mat: 'ice' }); }
        t.melt = ab.rounds ?? 3;
      }
      break;
    case 'vines':
      for (const g of foesIn(area3(s, x, z))) {
        if (CLASSES[g.cls].structure) continue;
        if (ab.amount) { const d = aura(s, g, ab.amount); damage(s, g, d, 'Thorns -' + d, 'ability', ev, u); }
        if (!g.alive || g.rooted) continue;
        g.rooted = true;
        g.guard = false;
        ev.push({ t: 'status', id: g.id, status: 'rooted' });
      }
      break;
    case 'blizzard':
      for (const g of foesIn(area3(s, x, z))) {
        const d = areaDamage(s, g, ab.amount!);
        damage(s, g, d, '-' + d, 'ability', ev, u);
        if (g.alive && !g.frozen && !CLASSES[g.cls].structure) {
          g.frozen = true;
          g.guard = false;
          ev.push({ t: 'status', id: g.id, status: 'frozen' });
        }
      }
      setOffTnt(s, area3(s, x, z), ev, u);
      break;
  }
  return ev;
}

// Area attacks set off any TNT they hit
function setOffTnt(s: GameState, cells: [number, number][], ev: GameEvent[], by: Unit) {
  for (const t of s.units.filter(o => o.alive && o.cls === 'tnt' && cells.some(([cx, cz]) => cx === o.x && cz === o.z))) {
    damage(s, t, t.hp, 'Boom', 'ability', ev, by);
  }
}

export function performTurret(s: GameState, u: Unit, x: number, z: number): GameEvent[] {
  return performAbility(s, u, x, z, 2);
}

// An empty Watchtower's crossbow shoots like a Turret (with the tower's bonuses)
function towerShooters(s: GameState, team: Team): Unit[] {
  const out: Unit[] = [];
  for (const row of s.tiles) for (const t of row) {
    if (!t.tower || unitAt(s, t.x, t.z)) continue;
    const owner = unitById(s, t.tower);
    if (!owner || !owner.alive || owner.team !== team) continue;
    out.push({ id: 'tw' + t.x + '_' + t.z, team, cls: 'turret', name: owner.name + "'s Watchtower", x: t.x, z: t.z, hp: 1, maxHp: 1, ap: 0, cd: 0, alive: true, guard: false, summons: 0, owner: owner.id });
  }
  return out;
}

// Each Turret shoots once: the target it is most likely to finish off, else the easiest hit
function turretsFire(s: GameState, team: Team): GameEvent[] {
  const ev: GameEvent[] = [];
  for (const tu of [...structures(s, team).filter(u => u.cls === 'turret'), ...towerShooters(s, team)]) {
    if (s.winner) break;
    const targets = enemiesOf(s, tu).filter(e => canAttackFrom(s, tu, e, tu.x, tu.z));
    if (!targets.length) continue;
    const mods: ShotMods = tu.id.startsWith('tw') ? { mult: BALANCE.tower.crossbowMult } : {};
    const score = (e: Unit) => { const i = hitInfo(s, tu, e, tu.x, tu.z, false, mods); return (i.dmg >= e.hp ? 100 : 0) + i.chance - e.hp; };
    const best = targets.reduce((a, b) => (score(b) > score(a) ? b : a));
    resolveAttack(s, tu, best, 0, ev, false, false, mods);
  }
  return ev;
}

function ignite(t: Tile, rounds: number, ev: GameEvent[]) {
  if (t.fire >= rounds) return;
  const was = t.fire > 0;
  t.fire = rounds;
  if (!was) ev.push({ t: 'fire', x: t.x, z: t.z, on: true });
}

/* ---------- Turns ---------- */

function startSide(s: GameState, team: Team): GameEvent[] {
  const ev: GameEvent[] = [];
  for (const u of living(s, team)) {
    u.ap = BALANCE.actionsPerTurn;
    u.guard = false; // overwatch lasts through the other side's turn only
    if (u.cd > 0) u.cd--;
    if ((u.cd2 ?? 0) > 0) u.cd2!--;
    // Frozen: skips this turn
    if (u.frozen) {
      u.frozen = false;
      u.ap = 0;
      ev.push({ t: 'status', id: u.id, status: 'thaw' });
    }
    // Standing next to a well heals a little
    let nearWell = false;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const t = tileAt(s, u.x + dx, u.z + dz);
      if (t && hasWell(t)) nearWell = true;
    }
    if (nearWell) heal(u, BALANCE.well.heal, 'well', ev);
  }
  return ev;
}

export function endPlayerTurn(s: GameState): GameEvent[] {
  if (s.phase !== 'player') return [];
  const ev = turretsFire(s, 'hero');
  if (s.winner) return ev;
  s.phase = 'enemy';
  for (const h of living(s, 'hero')) { h.ap = 0; h.rooted = false; }
  ev.push(...startSide(s, 'gob'));
  return ev;
}

// Fire burns down wood, spreads to nearby wood and hay, and hurts anyone standing in it
function fireTick(s: GameState): GameEvent[] {
  const ev: GameEvent[] = [];
  const burning: Tile[] = [];
  for (const row of s.tiles) for (const t of row) if (t.fire > 0) burning.push(t);
  for (const t of burning) {
    const top = t.blocks[t.blocks.length - 1];
    if (top && BURNABLE.has(top)) ev.push({ t: 'blockRemoved', x: t.x, z: t.z, mat: t.blocks.pop()!, cause: 'fire' });
    if (t.tower) { t.tower = undefined; ev.push({ t: 'tower', x: t.x, z: t.z, on: false }); }
    for (const [dx, dz] of N4) {
      const n = tileAt(s, t.x + dx, t.z + dz);
      if (!n || n.fire > 0 || !n.blocks.length || !BURNABLE.has(n.blocks[n.blocks.length - 1])) continue;
      if (next(s.rng) < BALANCE.fire.spreadChance) ignite(n, BALANCE.fire.blockRounds, ev);
    }
    const u = unitAt(s, t.x, t.z);
    if (u) damage(s, u, BALANCE.fire.burnDamage, 'Burn -' + BALANCE.fire.burnDamage, 'fire', ev);
    t.fire--;
    if (t.fire <= 0) { t.fire = 0; ev.push({ t: 'fire', x: t.x, z: t.z, on: false }); }
  }
  return ev;
}

// Ice Walls melt away
function meltTick(s: GameState): GameEvent[] {
  const ev: GameEvent[] = [];
  for (const row of s.tiles) for (const t of row) {
    if (!t.melt) continue;
    t.melt--;
    if (t.melt > 0) continue;
    t.melt = undefined;
    while (t.blocks.length && t.blocks[t.blocks.length - 1] === 'ice') ev.push({ t: 'blockRemoved', x: t.x, z: t.z, mat: t.blocks.pop()!, cause: 'melt' });
  }
  return ev;
}

export function endEnemyTurn(s: GameState): GameEvent[] {
  if (s.phase === 'over') return [];
  const ev = fireTick(s);
  if (s.winner) return ev;
  // Lit TNT goes off once the goblins have moved
  for (const t of s.units.filter(u => u.alive && u.cls === 'tnt')) {
    if (s.winner) break;
    if (t.alive) damage(s, t, t.hp, 'Boom', 'ability', ev, t);
  }
  if (s.winner) return ev;
  ev.push(...meltTick(s));
  for (const g of living(s, 'gob')) g.rooted = false;
  s.turn++;
  s.phase = 'player';
  ev.push(...startSide(s, 'hero'));
  return ev;
}
