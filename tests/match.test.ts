import { describe, expect, it } from 'vitest';
import { addUnit, createGame, def, living, performAbility, endPlayerTurn, type SquadMember } from '../app/src/rules/game';
import { actAllowed, applyAct, controls, playersTurn, sideHasMoves, stateHash, teamOf, type Act } from '../app/src/rules/match';
import { chooseAction, turnOrder } from '../app/src/rules/ai';
import { applyBattle, newCampaign, squadMembers } from '../app/src/rules/campaign';
import { CLASSES } from '../app/src/rules/balance';
import type { GameState } from '../app/src/rules/types';
import { blank } from './helpers';

const A: SquadMember[] = [
  { cls: 'knight', name: 'Sir A' }, { cls: 'archer', name: 'Robin' }, { cls: 'mage', name: 'Merla' }, { cls: 'cleric', name: 'Ada' }
];
const B: SquadMember[] = [
  { cls: 'knight', name: 'Evan', level: 3, path: 'paladin', gear: ['ironSword'] }, { cls: 'builder', name: 'Bob' },
  { cls: 'archer', name: 'Wren' }, { cls: 'mage', name: 'Zap' }
];

function duel(seed = 11): GameState {
  return createGame({ seed, diff: 'normal', theme: 'village', squad: A, squad2: B, mode: 'duel', match: { names: ['Dad', 'Evan'], teams: ['hero', 'gob'], seq: 0 } });
}

// The host plays every unit with the CPU brain and sends each move to a second copy of the game
function autoplay(host: GameState, guest: GameState, maxActs = 4000): number {
  let n = 0;
  const send = (a: Act) => {
    applyAct(host, a);
    applyAct(guest, a);
    n++;
    expect(stateHash(guest)).toBe(stateHash(host));
  };
  while (host.phase !== 'over' && n < maxActs) {
    const side = host.phase === 'player' ? 'hero' : 'gob';
    const u = turnOrder(host, side).find(x => x.ap > 0);
    if (!u) { send({ k: 'endSide' }); continue; }
    const a = chooseAction(host, u);
    send({ k: 'ai', id: u.id, a, r: host.rng.s });
  }
  return n;
}

describe('Duel', () => {
  it('puts a squad of heroes on each side, with their levels and gear', () => {
    const s = duel();
    expect(living(s, 'hero').map(u => u.cls)).toEqual(A.map(m => m.cls));
    expect(living(s, 'gob').map(u => u.cls)).toEqual(B.map(m => m.cls));
    const pal = living(s, 'gob')[0];
    expect(pal.path).toBe('paladin');
    expect(pal.gear).toEqual(['ironSword']);
    expect(def(pal).dmg).toBeGreaterThan(CLASSES.knight.dmg);
    expect(teamOf(s, 0)).toBe('hero');
    expect(teamOf(s, 1)).toBe('gob');
  });

  it('turns go back and forth, and only the side whose turn it is can move', () => {
    const s = duel();
    const mine = living(s, 'hero')[0], theirs = living(s, 'gob')[0];
    expect(playersTurn(s, 0)).toBe(true);
    expect(playersTurn(s, 1)).toBe(false);
    expect(actAllowed(s, { k: 'guard', id: theirs.id }, 1)).toBe(false);
    expect(actAllowed(s, { k: 'guard', id: theirs.id }, 0)).toBe(false); // not your hero
    expect(actAllowed(s, { k: 'guard', id: mine.id }, 0)).toBe(true);
    applyAct(s, { k: 'done', player: 0 });
    expect(sideHasMoves(s)).toBe(false);
    applyAct(s, { k: 'endSide' });
    expect(s.phase).toBe('enemy');
    expect(living(s, 'gob').every(u => u.ap === 2)).toBe(true);
    expect(sideHasMoves(s)).toBe(true);
    expect(actAllowed(s, { k: 'guard', id: theirs.id }, 1)).toBe(true);
    applyAct(s, { k: 'done', player: 1 });
    applyAct(s, { k: 'endSide' });
    expect(s.phase).toBe('player');
    expect(s.turn).toBe(2);
  });

  it('two phones playing the same moves stay identical to the end', () => {
    for (const seed of [3, 8, 21]) {
      const host = duel(seed), guest = JSON.parse(JSON.stringify(host)) as GameState;
      const n = autoplay(host, guest, 1500);
      expect(n).toBeGreaterThan(10);
      expect(host.turn).toBeGreaterThan(3);
    }
  });

  it('a Watchtower and a Snare work against whichever side is the enemy', () => {
    const s = blank();
    s.mode = 'duel';
    const arch = addUnit(s, 'builder', 'gob', [5, 5], 'Arch', undefined, { path: 'architect', level: 3 });
    const foe = addUnit(s, 'knight', 'hero', [5, 8]);
    s.tiles[6][5].tower = arch.id;
    s.tiles[7][4].trap = arch.id;
    foe.ap = 2;
    // The enemy can't climb the far squad's tower, and the far squad's own heroes can
    expect(actAllowed({ ...s, phase: 'player' }, { k: 'move', id: foe.id, path: [{ x: 5, z: 7 }, { x: 5, z: 6 }] }, 0)).toBe(false);
    s.match = { names: ['a', 'b'], teams: ['hero', 'gob'], seq: 0 };
    // Walking onto the hidden snare stops the enemy
    const ev = applyAct(s, { k: 'move', id: foe.id, path: [{ x: 4, z: 8 }, { x: 4, z: 7 }, { x: 4, z: 6 }] });
    expect(ev.some(e => e.t === 'trap' && e.sprung === foe.id)).toBe(true);
    expect([foe.x, foe.z]).toEqual([4, 7]);
  });

  it("the far squad's TNT goes off after the near side's turn", () => {
    const s = blank();
    s.mode = 'duel';
    const demo = addUnit(s, 'builder', 'gob', [5, 5], 'Demo', undefined, { path: 'demolitionist', level: 3 });
    const foe = addUnit(s, 'knight', 'hero', [5, 8]);
    demo.ap = 2;
    s.phase = 'enemy';
    performAbility(s, demo, 5, 7, 1);
    expect(s.units.some(u => u.cls === 'tnt' && u.alive)).toBe(true);
    applyAct(s, { k: 'endSide' }); // the far squad ends its turn: TNT waits
    expect(s.units.some(u => u.cls === 'tnt' && u.alive)).toBe(true);
    applyAct(s, { k: 'endSide' }); // the near side ends its turn: boom
    expect(s.units.some(u => u.cls === 'tnt' && u.alive)).toBe(false);
    expect(foe.hp).toBeLessThan(foe.maxHp);
  });

  it('rejects moves that jump, walk through walls or go too far', () => {
    const s = duel(5);
    const u = living(s, 'hero')[0];
    expect(actAllowed(s, { k: 'move', id: u.id, path: [{ x: u.x, z: u.z - 3 }] }, 0)).toBe(false);
    const far = Array.from({ length: def(u).move + 1 }, (_, i) => ({ x: u.x, z: u.z - 1 - i }));
    expect(actAllowed(s, { k: 'move', id: u.id, path: far }, 0)).toBe(false);
  });
});

describe('Co-op', () => {
  function coop(seed = 4) {
    const dad = newCampaign([], () => 0.3), kid = newCampaign([], () => 0.6);
    const squad = [
      ...squadMembers(dad).slice(0, 2).map(m => ({ ...m, player: 0 })),
      ...squadMembers(kid).slice(0, 2).map(m => ({ ...m, player: 1 }))
    ];
    const s = createGame({ seed, diff: 'easy', theme: 'village', squad, mode: 'coop', match: { names: ['Dad', 'Evan'], teams: ['hero', 'hero'], seq: 0 } });
    return { s, dad, kid };
  }

  it('each player commands only their own two heroes, in the same turn', () => {
    const { s } = coop();
    const heroes = living(s, 'hero');
    expect(heroes.map(u => u.player)).toEqual([0, 0, 1, 1]);
    expect(controls(s, 0, heroes[0])).toBe(true);
    expect(controls(s, 0, heroes[2])).toBe(false);
    expect(actAllowed(s, { k: 'guard', id: heroes[2].id }, 0)).toBe(false);
    expect(actAllowed(s, { k: 'guard', id: heroes[2].id }, 1)).toBe(true);
    // Finishing only ends your own heroes' turn
    applyAct(s, { k: 'done', player: 0 });
    expect(heroes.map(u => u.ap)).toEqual([0, 0, 2, 2]);
    expect(sideHasMoves(s)).toBe(true);
    applyAct(s, { k: 'done', player: 1 });
    expect(sideHasMoves(s)).toBe(false);
  });

  it('the goblins play the same on both phones, and each player gets their own rewards', () => {
    const { s, dad, kid } = coop(9);
    const guest = JSON.parse(JSON.stringify(s)) as GameState;
    autoplay(s, guest);
    expect(s.phase).toBe('over');
    const r0 = applyBattle(dad, s, () => 0.5, 0)!;
    const r1 = applyBattle(kid, guest, () => 0.5, 1)!;
    expect(r0.heroes.map(h => h.id)).toEqual(squadMembers(newCampaign([], () => 0.3)).slice(0, 2).map(m => m.heroId));
    expect(r1.heroes).toHaveLength(2);
    expect(dad.battles).toBe(1);
    expect(kid.battles).toBe(1);
  });

  it('a co-op battle ends the hero turn once both players are done', () => {
    const { s } = coop();
    applyAct(s, { k: 'done', player: 0 });
    applyAct(s, { k: 'done', player: 1 });
    expect(endPlayerTurn(s).length).toBeGreaterThanOrEqual(0);
    expect(s.phase).toBe('enemy');
  });
});
