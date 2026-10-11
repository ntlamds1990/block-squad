// Pure game rules: no graphics, no DOM. Every change to the game state goes through these functions,
// which return a list of events for the screen to animate. The CPU, the tests and (later) two-phone
// play all use the same rules.
import { BALANCE, CLASSES, type AbilityDef, type ClassDef, type ClassId, type Difficulty, type HeroClass, type Team } from './balance';
import { BURNABLE, type AttackKind, type GameEvent, type GameState, type Theme, type Tile, type Unit } from './types';
import { makeRng, next, shuffle } from './rng';
import { generateLayout, layoutToTiles } from './map';

export const SIZE = 16;
export const N4: ReadonlyArray<readonly [number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1]];
export const key = (x: number, z: number) => x + ',' + z;

export interface SquadMember { cls: HeroClass; name: string }
export interface NewGameOptions { diff: Difficulty; theme: Theme; squad: SquadMember[]; seed: number }

/* ---------- Setup ---------- */

export function createGame(o: NewGameOptions): GameState {
  const rng = makeRng(o.seed);
  const tiles = layoutToTiles(generateLayout(rng, SIZE, o.theme));
  const s: GameState = { size: SIZE, theme: o.theme, diff: o.diff, tiles, units: [], turn: 1, phase: 'player', winner: null, rng, nextId: 1 };
  const heroSpots = shuffle(rng, openSpots(s, SIZE - 3, SIZE - 1));
  o.squad.forEach((m, i) => addUnit(s, m.cls, 'hero', heroSpots[i], m.name));
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

export function addUnit(s: GameState, c: ClassId, team: Team, at: [number, number], name?: string, hp?: number): Unit {
  const C = CLASSES[c];
  let maxHp = hp ?? C.hp + (team === 'gob' ? BALANCE.difficulty[s.diff].goblinHpBonus : 0);
  const u: Unit = {
    id: (team === 'hero' ? 'h' : 'g') + s.nextId++, team, cls: c, name: name ?? C.label,
    x: at[0], z: at[1], hp: maxHp, maxHp, ap: 0, cd: 0, alive: true, guard: false, summons: 0
  };
  s.units.push(u);
  return u;
}

/* ---------- Queries ---------- */

export const inside = (s: GameState, x: number, z: number) => x >= 0 && z >= 0 && x < s.size && z < s.size;
export const tileAt = (s: GameState, x: number, z: number): Tile | null => inside(s, x, z) ? s.tiles[z][x] : null;
export const hAt = (s: GameState, x: number, z: number) => inside(s, x, z) ? s.tiles[z][x].blocks.length : 0;
export const unitAt = (s: GameState, x: number, z: number) => s.units.find(u => u.alive && u.x === x && u.z === z) ?? null;
export const unitById = (s: GameState, id: string) => s.units.find(u => u.id === id) ?? null;
export const living = (s: GameState, team: Team) => s.units.filter(u => u.alive && u.team === team);
export const enemiesOf = (s: GameState, u: Unit) => living(s, u.team === 'hero' ? 'gob' : 'hero');
export const def = (u: Unit): ClassDef => CLASSES[u.cls];
export const abilityOf = (u: Unit): AbilityDef | undefined => CLASSES[u.cls].ability;
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
  if (s.theme !== 'forest' || u.team === viewer) return true;
  const r = viewer === 'hero' ? BALANCE.sight.forestHero : BALANCE.sight.forestGoblin;
  return living(s, viewer).some(v => dist(v.x, v.z, u.x, u.z) <= r + 0.01);
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
      const occ = unitAt(s, nx, nz);
      if (occ && occ !== self) continue;
      const d = cur.d + (t.blocks.length ? BALANCE.troll.wallStepCost : 1);
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
  if (u.ap <= 0) return new Map();
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
  if (Math.abs(dx) + Math.abs(dz) <= 1) return 0;
  const ax = Math.abs(dx), az = Math.abs(dz), sx = Math.sign(dx), sz = Math.sign(dz);
  let c = 0;
  if (sx && ax >= az * 0.5) c = Math.max(c, hAt(s, tx + sx, tz));
  if (sz && az >= ax * 0.5) c = Math.max(c, hAt(s, tx, tz + sz));
  return Math.min(c, 2);
}

export function canAttackFrom(s: GameState, a: Unit, t: Unit, fx: number, fz: number): boolean {
  if (!t.alive || t.team === a.team || !canSee(s, a.team, t)) return false;
  if (def(a).range === 1) return adjacent(fx, fz, t.x, t.z);
  return dist(fx, fz, t.x, t.z) <= def(a).range + 0.01 && los(s, fx, fz, t.x, t.z);
}

export interface HitInfo { chance: number; cover: number; dmg: number }
export function hitInfo(s: GameState, a: Unit, t: Unit, fx = a.x, fz = a.z): HitInfo {
  const C = def(a);
  const cover = coverAt(s, t.x, t.z, fx, fz);
  let chance = C.aim;
  if (cover === 1) chance -= BALANCE.coverPenalty.half;
  if (cover === 2) chance -= BALANCE.coverPenalty.full;
  if (cover === 0 && C.range > 1) chance += BALANCE.openShotBonus;
  const d = dist(fx, fz, t.x, t.z);
  if (C.range > 1 && d > BALANCE.longRange.from) chance -= Math.round((d - BALANCE.longRange.from) * BALANCE.longRange.penaltyPerTile);
  if (a.team === 'gob') chance += BALANCE.difficulty[s.diff].goblinAim;
  return { chance: clampChance(chance), cover, dmg: C.dmg };
}
const clampChance = (c: number) => Math.max(BALANCE.chanceLimits.min, Math.min(BALANCE.chanceLimits.max, Math.round(c)));

export function attackTargets(s: GameState, u: Unit): Unit[] {
  if (u.ap <= 0) return [];
  return enemiesOf(s, u).filter(t => canAttackFrom(s, u, t, u.x, u.z));
}

// Best tile to step to with one move so the unit can attack with its second action
export function moveAttackOption(s: GameState, u: Unit, t: Unit): { node: PathNode; info: HitInfo } | null {
  if (u.ap < 2) return null;
  let best: { node: PathNode; info: HitInfo; score: number } | null = null;
  moveTiles(s, u).forEach(n => {
    if (tileAt(s, n.x, n.z)!.fire > 0) return;
    if (!canAttackFrom(s, u, t, n.x, n.z)) return;
    const info = hitInfo(s, u, t, n.x, n.z);
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

export function abilityTargets(s: GameState, u: Unit): [number, number][] {
  const ab = abilityOf(u);
  if (!ab) return [];
  switch (ab.key) {
    case 'spin':
      return enemiesOf(s, u).some(g => adjacent(u.x, u.z, g.x, g.z) && canSee(s, u.team, g)) ? [[u.x, u.z]] : [];
    case 'build':
      return N4.map(([dx, dz]) => [u.x + dx, u.z + dz] as [number, number])
        .filter(([x, z]) => { const t = tileAt(s, x, z); return !!t && t.blocks.length < 2 && !hasWell(t) && !unitAt(s, x, z); });
    case 'heal':
      return living(s, u.team).filter(a => a.hp < a.maxHp && dist(u.x, u.z, a.x, a.z) <= (ab.range ?? 4) + 0.01).map(a => [a.x, a.z]);
    case 'summon':
      if (u.summons >= BALANCE.shaman.maxSummons) return [];
      return N4.map(([dx, dz]) => [u.x + dx, u.z + dz] as [number, number])
        .filter(([x, z]) => { const t = tileAt(s, x, z); return !!t && !t.blocks.length && !unitAt(s, x, z); });
    case 'volley':
    case 'fireball': {
      const out: [number, number][] = [];
      for (let z = 0; z < s.size; z++) for (let x = 0; x < s.size; x++) {
        if (x === u.x && z === u.z) continue;
        if (dist(u.x, u.z, x, z) <= (ab.range ?? 5) + 0.01 && los(s, u.x, u.z, x, z)) out.push([x, z]);
      }
      return out;
    }
  }
  return [];
}
export function abilityReady(s: GameState, u: Unit): boolean {
  const ab = abilityOf(u);
  return !!ab && u.ap > 0 && u.cd <= 0 && abilityTargets(s, u).length > 0;
}

export function attackKind(u: Unit): AttackKind {
  switch (u.cls) {
    case 'archer': case 'garcher': return 'arrow';
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

function damage(s: GameState, u: Unit, n: number, label: string, cause: 'hit' | 'graze' | 'ability' | 'fire', ev: GameEvent[]) {
  if (!u.alive) return;
  u.hp = Math.max(0, u.hp - n);
  ev.push({ t: 'damage', id: u.id, amount: n, label, cause });
  if (u.hp <= 0) {
    u.alive = false;
    u.guard = false;
    ev.push({ t: 'death', id: u.id });
    checkWinner(s);
  }
}

function heal(u: Unit, n: number, cause: 'ability' | 'well', ev: GameEvent[]) {
  const amount = Math.min(n, u.maxHp - u.hp);
  if (amount <= 0 || !u.alive) return;
  u.hp += amount;
  ev.push({ t: 'heal', id: u.id, amount, cause });
}

function resolveAttack(s: GameState, a: Unit, t: Unit, penalty: number, ev: GameEvent[], overwatch = false) {
  const info = hitInfo(s, a, t);
  const chance = clampChance(info.chance - penalty);
  const hit = next(s.rng) * 100 < chance;
  ev.push({ t: 'attack', id: a.id, target: t.id, kind: attackKind(a), hit, chance, overwatch });
  if (hit) damage(s, t, info.dmg, '-' + info.dmg, 'hit', ev);
  else damage(s, t, BALANCE.graze, 'Graze -' + BALANCE.graze, 'graze', ev);
}

function overwatchCheck(s: GameState, mover: Unit, ev: GameEvent[]) {
  for (const h of enemiesOf(s, mover)) {
    if (!h.guard || !canAttackFrom(s, h, mover, h.x, h.z)) continue;
    h.guard = false;
    resolveAttack(s, h, mover, BALANCE.overwatchPenalty, ev, true);
    if (!mover.alive) return;
  }
}

export function performMove(s: GameState, u: Unit, path: { x: number; z: number }[]): GameEvent[] {
  const ev: GameEvent[] = [];
  u.ap -= 1;
  u.guard = false;
  for (const st of path) {
    const t = s.tiles[st.z][st.x];
    while (t.blocks.length) ev.push({ t: 'blockRemoved', x: st.x, z: st.z, mat: t.blocks.pop()!, cause: 'smash' });
    u.x = st.x; u.z = st.z;
    ev.push({ t: 'step', id: u.id, x: st.x, z: st.z });
    if (t.fire > 0) damage(s, u, BALANCE.fire.burnDamage, 'Burn -' + BALANCE.fire.burnDamage, 'fire', ev);
    if (!u.alive || s.winner) break;
    overwatchCheck(s, u, ev);
    if (!u.alive || s.winner) break;
  }
  return ev;
}

export function performAttack(s: GameState, a: Unit, t: Unit): GameEvent[] {
  const ev: GameEvent[] = [];
  a.ap = 0;
  a.guard = false;
  resolveAttack(s, a, t, 0, ev);
  return ev;
}

export function performMoveAttack(s: GameState, a: Unit, path: { x: number; z: number }[], t: Unit): GameEvent[] {
  const ev = performMove(s, a, path);
  if (a.alive && t.alive && !s.winner && canAttackFrom(s, a, t, a.x, a.z)) {
    a.ap = 0;
    resolveAttack(s, a, t, 0, ev);
  }
  return ev;
}

export function performDig(s: GameState, u: Unit, x: number, z: number): GameEvent[] {
  const t = s.tiles[z][x];
  u.ap -= 1;
  u.guard = false;
  const mat = t.blocks.pop();
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

export function performAbility(s: GameState, u: Unit, x: number, z: number): GameEvent[] {
  const ab = abilityOf(u)!;
  const ev: GameEvent[] = [{ t: 'ability', id: u.id, key: ab.key, x, z }];
  u.cd = ab.cd;
  if (ab.costsOneAction) u.ap -= 1; else u.ap = 0;
  u.guard = false;
  const foesIn = (cells: [number, number][]) => enemiesOf(s, u).filter(g => cells.some(([cx, cz]) => cx === g.x && cz === g.z));
  switch (ab.key) {
    case 'spin':
      enemiesOf(s, u).filter(g => adjacent(u.x, u.z, g.x, g.z)).forEach(g => damage(s, g, ab.amount!, '-' + ab.amount, 'ability', ev));
      break;
    case 'volley':
      foesIn(area3(s, x, z)).forEach(g => damage(s, g, ab.amount!, '-' + ab.amount, 'ability', ev));
      break;
    case 'fireball': {
      const cells = area3(s, x, z);
      for (const [cx, cz] of cells) {
        const t = s.tiles[cz][cx];
        while (t.blocks.length && !hasWell(t)) ev.push({ t: 'blockRemoved', x: cx, z: cz, mat: t.blocks.pop()!, cause: 'blast' });
        if (!hasWell(t)) ignite(t, BALANCE.fire.groundRounds, ev);
      }
      // Wood, hay and leaves around the blast catch fire
      for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
        if (Math.abs(dx) <= 1 && Math.abs(dz) <= 1) continue;
        const t = tileAt(s, x + dx, z + dz);
        if (t && t.blocks.length && BURNABLE.has(t.blocks[t.blocks.length - 1]) && Math.max(Math.abs(dx), Math.abs(dz)) === 2) ignite(t, BALANCE.fire.blockRounds, ev);
      }
      foesIn(cells).forEach(g => damage(s, g, ab.amount!, '-' + ab.amount, 'ability', ev));
      break;
    }
    case 'build': {
      const t = s.tiles[z][x];
      t.blocks.push('cobble');
      if (t.fire > 0) { t.fire = 0; ev.push({ t: 'fire', x, z, on: false }); }
      ev.push({ t: 'blockAdded', x, z, mat: 'cobble' });
      break;
    }
    case 'heal': {
      const target = unitAt(s, x, z);
      if (target) heal(target, ab.amount ?? 2, 'ability', ev);
      break;
    }
    case 'summon': {
      const imp = addUnit(s, 'grunt', u.team, [x, z], 'Goblin', BALANCE.shaman.summonHp);
      u.summons++;
      ev.push({ t: 'summon', id: imp.id, by: u.id });
      break;
    }
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
  s.phase = 'enemy';
  for (const h of living(s, 'hero')) h.ap = 0;
  return startSide(s, 'gob');
}

// Fire burns down wood, spreads to nearby wood and hay, and hurts anyone standing in it
function fireTick(s: GameState): GameEvent[] {
  const ev: GameEvent[] = [];
  const burning: Tile[] = [];
  for (const row of s.tiles) for (const t of row) if (t.fire > 0) burning.push(t);
  for (const t of burning) {
    const top = t.blocks[t.blocks.length - 1];
    if (top && BURNABLE.has(top)) ev.push({ t: 'blockRemoved', x: t.x, z: t.z, mat: t.blocks.pop()!, cause: 'fire' });
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

export function endEnemyTurn(s: GameState): GameEvent[] {
  if (s.phase === 'over') return [];
  const ev = fireTick(s);
  if (s.winner) return ev;
  s.turn++;
  s.phase = 'player';
  ev.push(...startSide(s, 'hero'));
  return ev;
}
