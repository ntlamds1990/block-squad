// The CPU brain. It works for any unit on either team: the goblins use it in real games, and the
// playtest simulator also uses it to play the heroes. It only reads the state and picks one action;
// applyAction then runs that action through the normal rules.
import { BALANCE, CLASSES } from './balance';
import { next } from './rng';
import type { GameEvent, GameState, Unit } from './types';
import {
  abilityOf, abilityTargets, area3, areaDamage, canAttackFrom, canSee, cdOf, coverAt, def, dist, enemiesOf,
  hitInfo, iceWallCells, los, living, moveTiles, near8, onTower, pathTo, performAbility, performAttack, performDig, performGuard, performMove,
  performMoveAttack, performShamanHeal, rangeFrom, tileAt, unitAt, unitById, moveAttackTiles, type PathNode, type Slot
} from './game';

export type Action =
  | { k: 'move'; path: { x: number; z: number }[] }
  | { k: 'attack'; target: string }
  | { k: 'moveAttack'; path: { x: number; z: number }[]; target: string }
  | { k: 'ability'; x: number; z: number; slot?: Slot }
  | { k: 'shamanHeal'; target: string }
  | { k: 'dig'; x: number; z: number }
  | { k: 'turret'; x: number; z: number }
  | { k: 'guard' }
  | { k: 'end' };

interface Scored { a: Action; score: number }

// Fire tiles walked through on the way to a node (each one burns)
function fireOnPath(s: GameState, n: PathNode | null): number {
  let c = 0;
  for (; n && n.prev; n = n.prev) if (tileAt(s, n.x, n.z)!.fire > 0) c++;
  return c;
}

export interface AiOptions { noise?: number }

const SHAMAN_HEAL = 2;
const SHAMAN_HEAL_RANGE = 5;

function noiseOf(s: GameState, u: Unit, o?: AiOptions): number {
  if (o?.noise !== undefined) return o.noise;
  return u.team === 'gob' ? BALANCE.difficulty[s.diff].aiNoise : 0.2;
}

const jitter = (s: GameState, n: number) => (next(s.rng) - 0.5) * n * 10;

// Value of hurting an enemy: expected damage, with a big bonus for a likely kill
function attackValue(t: Unit, chance: number, dmg: number): number {
  const p = chance / 100;
  const expected = p * dmg + (1 - p) * BALANCE.graze;
  const killP = (dmg >= t.hp ? p : 0) + (BALANCE.graze >= t.hp ? 1 - p : 0);
  return expected * 8 + killP * 14 + (def(t).dmg >= 3 ? 2 : 0);
}

// Damage from an ability that never misses
function sureValue(t: Unit, dmg: number): number {
  return Math.min(dmg, t.hp) * 8 + (dmg >= t.hp ? 14 : 0);
}

// Lit TNT next to (x, z): heroes keep clear (goblins don't know what TNT is)
function nearTnt(s: GameState, x: number, z: number, u?: Unit): boolean {
  if (u && u.team === 'gob') return false;
  return s.units.some(t => t.alive && t.cls === 'tnt' && Math.max(Math.abs(t.x - x), Math.abs(t.z - z)) <= 1);
}

// How exposed a unit would be standing at (x, z): negative is dangerous
function safety(s: GameState, u: Unit, x: number, z: number): number {
  let v = nearTnt(s, x, z, u) ? -12 : 0;
  if (onTower(s, x, z)) v += 3;
  for (const e of enemiesOf(s, u)) {
    if (!canSee(s, u.team, e)) continue;
    const d = dist(x, z, e.x, e.z);
    const threat = def(e).range > 1 ? def(e).range + 1 : def(e).move + 1;
    if (d > threat) continue;
    const c = coverAt(s, x, z, e.x, e.z);
    v += c === 2 ? 4 : c === 1 ? 2 : -3;
  }
  return v;
}

function abilityOptions(s: GameState, u: Unit, slot: Slot = 1): Scored[] {
  const ab = abilityOf(u, slot);
  if (!ab || u.ap <= 0 || cdOf(u, slot) > 0) return [];
  const out: Scored[] = [];
  const cells = abilityTargets(s, u, slot);
  const act = (x: number, z: number): Action => ({ k: 'ability', x, z, slot });
  const foes = enemiesOf(s, u).filter(e => canSee(s, u.team, e));
  const friends = living(s, u.team);
  switch (ab.key) {
    case 'spin': {
      const hit = foes.filter(g => near8(u.x, u.z, g.x, g.z) && !CLASSES[g.cls].structure);
      const v = hit.reduce((a, g) => a + sureValue(g, ab.amount!), 0);
      if (hit.length) out.push({ a: act(u.x, u.z), score: v + (hit.length >= 2 ? 4 : 0) });
      break;
    }
    case 'aimedShot':
      for (const [x, z] of cells) {
        const t = unitAt(s, x, z)!;
        const info = hitInfo(s, u, t, u.x, u.z, false, { bonus: ab.aimBonus, mult: ab.mult });
        out.push({ a: act(x, z), score: attackValue(t, info.chance, info.dmg) + 1 });
      }
      break;
    case 'layOnHands':
      for (const [x, z] of cells) {
        const f = unitAt(s, x, z)!;
        const missing = f.maxHp - f.hp;
        if (missing < 2 && f.hp > 1) continue;
        out.push({ a: act(x, z), score: Math.min(missing, ab.amount ?? 2) * 6 + (f.hp <= 2 ? 8 : 0) });
      }
      break;
    case 'vines': {
      for (const [x, z] of cells) {
        const area = area3(s, x, z);
        const hit = foes.filter(g => !CLASSES[g.cls].structure && !g.rooted && area.some(([cx, cz]) => cx === g.x && cz === g.z));
        // Rooting melee goblins that are about to reach the squad is worth most
        const v = hit.reduce((a, g) => a + (def(g).range === 1 ? 5 : 2) + (def(g).dmg >= 3 ? 3 : 0) + sureValue(g, ab.amount ?? 0), 0);
        if (hit.length >= 2 || v >= 12) out.push({ a: act(x, z), score: v });
      }
      break;
    }
    case 'snare': {
      // Put a trap on the way between the nearest goblin and the squad
      if (!foes.length) break;
      let best: Scored | null = null;
      for (const [x, z] of cells) {
        const near = Math.min(...foes.map(e => dist(x, z, e.x, e.z)));
        if (near < 1.5 || near > 4.5) continue;
        const score = 10 - near;
        if (!best || score > best.score) best = { a: act(x, z), score };
      }
      if (best) out.push(best);
      break;
    }
    case 'tnt': {
      for (const [x, z] of cells) {
        const area = area3(s, x, z);
        const inA = (w: Unit) => area.some(([cx, cz]) => cx === w.x && cz === w.z);
        const hit = foes.filter(g => inA(g) && !CLASSES[g.cls].structure);
        if (!hit.length) continue;
        // Goblins may walk away before it goes off, so count it at about half
        const v = hit.reduce((a, g) => a + sureValue(g, areaDamage(s, g, BALANCE.tnt.damage)) * 0.5, 0) - living(s, u.team).filter(inA).length * 14;
        if (v > 6) out.push({ a: act(x, z), score: v });
      }
      break;
    }
    case 'iceWall': {
      // Wall off the goblin archers shooting at the squad
      const shooters = foes.filter(g => def(g).range > 1);
      if (!shooters.length) break;
      const e = shooters.reduce((a, b) => (dist(u.x, u.z, a.x, a.z) <= dist(u.x, u.z, b.x, b.z) ? a : b));
      let best: Scored | null = null;
      for (const [x, z] of cells) {
        const n = iceWallCells(s, u, x, z).length;
        if (n < 2) continue;
        const dE = dist(x, z, e.x, e.z);
        if (dE < 1.5 || dE > 3.5) continue;
        const score = 7 + n - Math.abs(dE - 2);
        if (!best || score > best.score) best = { a: act(x, z), score };
      }
      if (best) out.push(best);
      break;
    }
    case 'turret': {
      let best: Scored | null = null;
      for (const [x, z] of cells) {
        const n = foes.filter(e => dist(x, z, e.x, e.z) <= CLASSES.turret.range + 0.01 && los(s, x, z, e.x, e.z)).length;
        const near = foes.filter(e => dist(x, z, e.x, e.z) <= 8).length;
        if (!n && !near) continue;
        const score = 9 + n * 3 + (near ? 1 : 0);
        if (!best || score > best.score) best = { a: act(x, z), score };
      }
      if (best) out.push(best);
      break;
    }
    case 'tower': {
      // Its crossbow shoots from up high, and a ranged friend can climb it
      if (!foes.length) break;
      const shooters = living(s, u.team).filter(f => f !== u && def(f).range > 1 && f.ap > 0);
      let best: Scored | null = null;
      for (const [x, z] of cells) {
        const n = foes.filter(e => dist(x, z, e.x, e.z) <= CLASSES.turret.range + BALANCE.tower.range + 0.01).length;
        const near = foes.filter(e => dist(x, z, e.x, e.z) <= 10).length;
        if (!n && !near) continue;
        const climb = shooters.some(f => dist(f.x, f.z, x, z) <= def(f).move) ? 2 : 0;
        const score = 9 + n * 3 + (near ? 1 : 0) + climb;
        if (!best || score > best.score) best = { a: act(x, z), score };
      }
      if (best) out.push(best);
      break;
    }
    case 'volley':
    case 'blizzard':
    case 'fireball': {
      for (const [x, z] of cells) {
        const area = area3(s, x, z);
        const inA = (w: Unit) => area.some(([cx, cz]) => cx === w.x && cz === w.z);
        const hit = foes.filter(inA);
        if (!hit.length) continue;
        let v = hit.reduce((a, g) => a + sureValue(g, ab.amount!) + (ab.key === 'blizzard' ? 4 : 0), 0);
        if (ab.key === 'fireball') v -= friends.filter(inA).length * 12; // allies would stand in the fire
        if (hit.length >= 2 || hit.some(g => g.hp <= ab.amount!)) out.push({ a: act(x, z), score: v });
      }
      break;
    }
    case 'heal': {
      for (const [x, z] of cells) {
        const f = unitAt(s, x, z)!;
        const missing = f.maxHp - f.hp;
        if (missing < 2 && f.hp > 1) continue;
        out.push({ a: act(x, z), score: Math.min(missing, ab.amount ?? 2) * 7 + (f.hp <= 2 ? 10 : 0) + (ab.bless ? 2 : 0) });
      }
      break;
    }
    case 'summon':
      if (cells.length) {
        // Put the new goblin on the side nearest the enemy
        const near = (c: [number, number]) => Math.min(99, ...foes.map(e => dist(c[0], c[1], e.x, e.z)));
        const best = cells.slice().sort((a, b) => near(a) - near(b))[0];
        out.push({ a: act(best[0], best[1]), score: 13 });
      }
      break;
    case 'build':
      break; // handled with positioning below
  }
  return out;
}

function shamanHealOptions(s: GameState, u: Unit): Scored[] {
  if (u.cls !== 'shaman' || u.ap <= 0) return [];
  return living(s, u.team)
    .filter(f => f.maxHp - f.hp >= 2 && dist(u.x, u.z, f.x, f.z) <= SHAMAN_HEAL_RANGE + 0.01)
    .map(f => ({ a: { k: 'shamanHeal', target: f.id } as Action, score: Math.min(SHAMAN_HEAL, f.maxHp - f.hp) * 7 + (f.hp <= 2 ? 8 : 0) }));
}

function attackOptions(s: GameState, u: Unit): Scored[] {
  const out: Scored[] = [];
  if (u.ap <= 0) return out;
  const foes = enemiesOf(s, u).filter(e => canSee(s, u.team, e));
  for (const t of foes) {
    if (t.cls === 'tnt') {
      // Hitting TNT sets it off right away: only worth it if the blast hurts the other side more
      if (canAttackFrom(s, u, t, u.x, u.z)) {
        const area = area3(s, t.x, t.z);
        const inA = (w: Unit) => w !== t && area.some(([cx, cz]) => cx === w.x && cz === w.z);
        const v = s.units.filter(w => w.alive && inA(w) && !CLASSES[w.cls].structure)
          .reduce((a, w) => a + (w.team === u.team ? -1.5 : 1) * sureValue(w, areaDamage(s, w, BALANCE.tnt.damage)), 0);
        if (v > 0) out.push({ a: { k: 'attack', target: t.id }, score: v * 0.7 });
      }
      continue;
    }
    if (canAttackFrom(s, u, t, u.x, u.z)) {
      const info = hitInfo(s, u, t);
      out.push({ a: { k: 'attack', target: t.id }, score: attackValue(t, info.chance, info.dmg) + safety(s, u, u.x, u.z) * 0.5 });
    }
    if (u.ap < 2) continue;
    let best: Scored | null = null;
    moveAttackTiles(s, u).forEach(n => {
      if (tileAt(s, n.x, n.z)!.fire > 0) return;
      if (!canAttackFrom(s, u, t, n.x, n.z)) return;
      const info = hitInfo(s, u, t, n.x, n.z, true);
      const score = attackValue(t, info.chance, info.dmg) + safety(s, u, n.x, n.z) * 0.5 - 0.5 - fireOnPath(s, n) * 12;
      if (!best || score > best.score) best = { a: { k: 'moveAttack', path: pathTo(n), target: t.id }, score };
    });
    if (best) out.push(best);
  }
  return out;
}

// Where to walk when there is nothing worth hitting this turn
function bestMove(s: GameState, u: Unit, tiles: Map<string, PathNode>, noise: number): Scored | null {
  const C = def(u);
  const visible = enemiesOf(s, u).filter(e => canSee(s, u.team, e));
  const all = enemiesOf(s, u);
  if (!all.length) return null;
  // With no one in sight, head for the middle of the enemy group (a rough guess at where they are)
  const gx = all.reduce((a, e) => a + e.x, 0) / all.length;
  const gz = all.reduce((a, e) => a + e.z, 0) / all.length;
  const wounded = u.maxHp - u.hp;
  const support = u.cls === 'cleric' || u.cls === 'shaman';
  const friends = living(s, u.team).filter(f => f !== u);
  const score = (x: number, z: number) => {
    let v = 0;
    if (tileAt(s, x, z)!.fire > 0) v -= 50;
    if (nearTnt(s, x, z, u)) v -= 30;
    if (visible.length) {
      const nearest = Math.min(...visible.map(e => dist(x, z, e.x, e.z)));
      if (C.range === 1) v -= nearest * 3;
      else {
        const want = Math.max(2, rangeFrom(s, u, x, z) - 1);
        v -= Math.abs(nearest - want) * 1.5;
        if (visible.some(e => canAttackFrom(s, u, e, x, z))) v += 5;
        if (onTower(s, x, z)) v += 4;
      }
      v += safety(s, u, x, z) * (C.range === 1 ? 0.6 : 1.4);
    } else {
      v -= dist(x, z, gx, gz) * 2;
    }
    if (support && friends.length) {
      const fd = Math.min(...friends.map(f => dist(x, z, f.x, f.z)));
      v -= Math.max(0, fd - 3) * 2;
    }
    if (wounded >= 2) {
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        if (tileAt(s, x + dx, z + dz)?.blocks.includes('well')) v += wounded * 2;
      }
    }
    return v + jitter(s, noise) * 0.3;
  };
  let best: Scored | null = { a: { k: 'end' }, score: score(u.x, u.z) };
  tiles.forEach(n => {
    const v = score(n.x, n.z) - fireOnPath(s, n) * 20;
    if (v > best!.score) best = { a: { k: 'move', path: pathTo(n) }, score: v };
  });
  return best && best.a.k === 'move' ? best : null;
}

// A Builder with a spare action raises cover between itself and the nearest goblin
function buildOption(s: GameState, u: Unit): Scored | null {
  if (abilityOf(u)?.key !== 'build' || u.ap <= 0) return null;
  const foes = enemiesOf(s, u).filter(e => canSee(s, u.team, e));
  if (!foes.length) return null;
  const e = foes.reduce((a, b) => (dist(u.x, u.z, a.x, a.z) <= dist(u.x, u.z, b.x, b.z) ? a : b));
  if (dist(u.x, u.z, e.x, e.z) > 8 || coverAt(s, u.x, u.z, e.x, e.z) === 2) return null;
  const cells = abilityTargets(s, u);
  const dx = Math.sign(e.x - u.x), dz = Math.sign(e.z - u.z);
  const pick = cells.find(([x, z]) => (x - u.x === dx && z === u.z) || (z - u.z === dz && x === u.x));
  return pick ? { a: { k: 'ability', x: pick[0], z: pick[1] }, score: 6 } : null;
}

export function chooseAction(s: GameState, u: Unit, o?: AiOptions): Action {
  if (!u.alive || u.ap <= 0 || s.phase === 'over') return { k: 'end' };
  const noise = noiseOf(s, u, o);
  const tiles = moveTiles(s, u);
  const options: Scored[] = [
    ...attackOptions(s, u),
    ...abilityOptions(s, u),
    ...abilityOptions(s, u, 2),
    ...shamanHealOptions(s, u)
  ].map(x => ({ ...x, score: x.score + jitter(s, noise) }));
  options.sort((a, b) => b.score - a.score);
  const top = options[0];
  // Good action available now: take it. With 2 actions, a weak option can wait for a better spot.
  if (top && (top.score >= 10 || u.ap === 1)) return top.a;
  if (u.ap >= 2) {
    const mv = bestMove(s, u, tiles, noise);
    if (mv) return mv.a;
  }
  if (top) return top.a;
  const b = buildOption(s, u);
  if (b) return b.a;
  if (u.team === 'hero') return { k: 'guard' };
  if (enemiesOf(s, u).some(e => canSee(s, u.team, e) && def(u).range > 1)) return { k: 'guard' };
  return { k: 'end' };
}

export function applyAction(s: GameState, u: Unit, a: Action): GameEvent[] {
  switch (a.k) {
    case 'move': return performMove(s, u, a.path);
    case 'attack': return performAttack(s, u, unitById(s, a.target)!);
    case 'moveAttack': return performMoveAttack(s, u, a.path, unitById(s, a.target)!);
    case 'ability': return performAbility(s, u, a.x, a.z, a.slot ?? 1);
    case 'shamanHeal': return performShamanHeal(s, u, unitById(s, a.target)!);
    case 'dig': return performDig(s, u, a.x, a.z);
    case 'turret': return performAbility(s, u, a.x, a.z, 2);
    case 'guard': return performGuard(s, u);
    case 'end': u.ap = 0; return [];
  }
}

// Run one unit's whole turn. Returns every event in order.
export function runUnitTurn(s: GameState, u: Unit, o?: AiOptions): GameEvent[] {
  const ev: GameEvent[] = [];
  for (let guard = 0; guard < 6 && u.alive && u.ap > 0 && s.phase !== 'over'; guard++) {
    const before = u.ap;
    ev.push(...applyAction(s, u, chooseAction(s, u, o)));
    if (u.ap >= before) u.ap = 0; // safety: never loop on an action that cost nothing
  }
  return ev;
}

// Order a team acts in: units that can already hit something go first, so they clear the way
export function turnOrder(s: GameState, team: 'hero' | 'gob'): Unit[] {
  return living(s, team).slice().sort((a, b) => nearestFoe(s, a) - nearestFoe(s, b));
}
function nearestFoe(s: GameState, u: Unit): number {
  return Math.min(99, ...enemiesOf(s, u).map(e => dist(u.x, u.z, e.x, e.z)));
}

