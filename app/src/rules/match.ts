// Two-phone games. Every move is a small message (an "Act") that both phones run through the same
// rules in the same order, so both boards stay identical. The phone that hosts the room decides the
// order, checks the other phone's moves, and plays the goblins.
import { CLASSES, type Team } from './balance';
import type { GameEvent, GameState, Unit } from './types';
import {
  N4, abilityReady, abilityTargets, attackTargets, canAttackFrom, def, digTargets, endEnemyTurn, endPlayerTurn, foeOf, living,
  performAbility, performAttack, performDig, performGuard, performMove, performMoveAttack, tileAt, unitAt, unitById, type Slot
} from './game';
import { applyAction, type Action } from './ai';

export interface XZ { x: number; z: number }

export type Act =
  | { k: 'move'; id: string; path: XZ[] }
  | { k: 'attack'; id: string; target: string }
  | { k: 'moveattack'; id: string; path: XZ[]; target: string }
  | { k: 'dig'; id: string; x: number; z: number }
  | { k: 'ability'; id: string; x: number; z: number; slot: Slot }
  | { k: 'guard'; id: string }
  | { k: 'done'; player?: number }   // a player has finished their part of the turn
  | { k: 'endSide' }                 // hand the turn to the other side
  | { k: 'ai'; id: string; a: Action; r: number }; // a goblin's move, picked by the host (r: the dice after picking)

// The side whose turn it is
export const activeSide = (s: GameState): Team | null => (s.phase === 'player' ? 'hero' : s.phase === 'enemy' ? 'gob' : null);

// The side a player commands (solo: always the heroes)
export const teamOf = (s: GameState, player?: number): Team =>
  s.match && player !== undefined ? s.match.teams[player] : 'hero';

// Can this player give orders to this unit?
export function controls(s: GameState, player: number | undefined, u: Unit): boolean {
  if (!u.alive || CLASSES[u.cls].structure || u.team !== teamOf(s, player)) return false;
  if (s.mode === 'coop' && player !== undefined) return u.player === player;
  return true;
}

// Is it this player's turn? (Co-op partners move in the same turn.)
export const playersTurn = (s: GameState, player?: number) => activeSide(s) === teamOf(s, player);

// People-controlled units on the active side that can still act
export function sideHasMoves(s: GameState): boolean {
  const side = activeSide(s);
  if (!side) return false;
  if (side === 'gob' && s.mode !== 'duel') return false;
  return living(s, side).some(u => u.ap > 0);
}

// A route a hero walks: one tile at a time, onto open ground, through nobody, within its move
function pathOk(s: GameState, u: Unit, path: XZ[], max: number): boolean {
  if (!Array.isArray(path) || !path.length || path.length > max) return false;
  let x = u.x, z = u.z;
  for (const st of path) {
    if (!N4.some(([dx, dz]) => x + dx === st.x && z + dz === st.z)) return false;
    const t = tileAt(s, st.x, st.z);
    if (!t || t.blocks.length || (t.tower && foeOf(s, t.tower, u))) return false;
    const occ = unitAt(s, st.x, st.z);
    if (occ && occ !== u) return false;
    x = st.x; z = st.z;
  }
  return true;
}

// The host checks every move the other phone sends before it becomes part of the game
export function actAllowed(s: GameState, a: Act, player: number): boolean {
  if (s.phase === 'over' || !playersTurn(s, player)) return false;
  if (a.k === 'done') return a.player === player;
  if (a.k === 'endSide' || a.k === 'ai') return false;
  const u = unitById(s, a.id);
  if (!u || !controls(s, player, u) || u.ap <= 0) return false;
  const at = (list: [number, number][], x: number, z: number) => list.some(([ax, az]) => ax === x && az === z);
  switch (a.k) {
    case 'move': return !u.rooted && pathOk(s, u, a.path, def(u).move);
    case 'attack': { const t = unitById(s, a.target); return !!t && attackTargets(s, u).includes(t); }
    case 'moveattack': {
      const t = unitById(s, a.target), end = a.path[a.path.length - 1];
      return !!t && u.ap >= 2 && !u.rooted && pathOk(s, u, a.path, def(u).move) && canAttackFrom(s, u, t, end.x, end.z);
    }
    case 'dig': return digTargets(s, u).some(t => t.x === a.x && t.z === a.z);
    case 'ability': return (a.slot === 1 || a.slot === 2) && abilityReady(s, u, a.slot) && at(abilityTargets(s, u, a.slot), a.x, a.z);
    case 'guard': return true;
  }
}

// Run one move through the rules. Both phones call this with the same moves in the same order.
export function applyAct(s: GameState, a: Act): GameEvent[] {
  switch (a.k) {
    case 'move': return performMove(s, unitById(s, a.id)!, a.path);
    case 'attack': return performAttack(s, unitById(s, a.id)!, unitById(s, a.target)!);
    case 'moveattack': return performMoveAttack(s, unitById(s, a.id)!, a.path, unitById(s, a.target)!);
    case 'dig': return performDig(s, unitById(s, a.id)!, a.x, a.z);
    case 'ability': return performAbility(s, unitById(s, a.id)!, a.x, a.z, a.slot);
    case 'guard': return performGuard(s, unitById(s, a.id)!);
    case 'done':
      for (const u of s.units) if (controls(s, a.player, u)) u.ap = 0;
      return [];
    case 'endSide': return s.phase === 'player' ? endPlayerTurn(s) : endEnemyTurn(s);
    case 'ai': {
      const g = unitById(s, a.id);
      if (!g || !g.alive) return [];
      s.rng.s = a.r;
      const before = g.ap;
      const ev = applyAction(s, g, a.a);
      if (g.ap >= before) g.ap = 0; // never loop on a move that cost nothing
      return ev;
    }
  }
}

// A short fingerprint of the whole game, so the phones can spot if their boards ever differ
export function stateHash(s: GameState): number {
  const text = JSON.stringify([s.turn, s.phase, s.rng.s, s.nextId, s.units, s.tiles]);
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}
