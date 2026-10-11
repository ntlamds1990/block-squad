import { describe, expect, it } from 'vitest';
import { BALANCE, PATHS, PATHS_OF, PROGRESS, type ClassId, type PathId } from '../app/src/rules/balance';
import {
  abilityTargets, addUnit, attackTargets, canAttackFrom, canSee, createGame, def, endEnemyTurn, endPlayerTurn, heroMaxHp,
  hitInfo, iceWallCells, living, moveTiles, performAbility, performAttack, performMove, unitAt
} from '../app/src/rules/game';
import {
  applyBattle, canPromote, ensureSquad, levelOf, newCampaign, promote, recruit, squadMembers, toggleSquad
} from '../app/src/rules/campaign';
import { runBattle } from '../app/src/rules/sim';
import { blank, put, wall } from './helpers';

const fixed = () => 0.5;

function hero(s: ReturnType<typeof blank>, cls: ClassId, x: number, z: number, path?: PathId, level = 3) {
  const u = addUnit(s, cls, 'hero', [x, z], undefined, undefined, { path, level });
  u.ap = 2;
  return u;
}

describe('levels and XP', () => {
  it('level 2 at 3 XP and level 3 at 7 XP', () => {
    expect([0, 2, 3, 6, 7, 20].map(levelOf)).toEqual([1, 1, 2, 2, 3, 3]);
  });

  it('level 2 gives an extra heart, and promotions keep it', () => {
    expect(heroMaxHp('archer', undefined, 1)).toBe(4);
    expect(heroMaxHp('archer', undefined, 2)).toBe(5);
    expect(heroMaxHp('knight', 'paladin', 3)).toBe(8);
  });

  it('every class has two paths, and every path belongs to its class', () => {
    for (const [cls, paths] of Object.entries(PATHS_OF)) {
      expect(paths).toHaveLength(2);
      for (const p of paths) expect(PATHS[p].cls).toBe(cls);
    }
    expect(Object.keys(PATHS)).toHaveLength(10);
  });
});

describe('the Barracks', () => {
  it('starts with 6 heroes, keeping the squad you already built, and picks 4', () => {
    const c = newCampaign([{ cls: 'knight', name: 'Evan' }, { cls: 'mage', name: 'Dad' }], fixed);
    expect(c.heroes).toHaveLength(PROGRESS.startRoster);
    expect(c.heroes[0].name).toBe('Evan');
    expect(new Set(c.heroes.map(h => h.cls)).size).toBe(5);
    expect(c.squad).toHaveLength(4);
    expect(squadMembers(c)[0]).toMatchObject({ cls: 'knight', name: 'Evan', level: 1 });
  });

  it('recruiting costs gold and the Barracks has a limit', () => {
    const c = newCampaign([], fixed);
    expect(typeof recruit(c, 'archer', 'Robin')).toBe('string');
    c.gold = 100;
    const h = recruit(c, 'archer', 'Robin');
    expect(typeof h).toBe('object');
    expect(c.gold).toBe(100 - PROGRESS.recruitCost);
    recruit(c, 'archer', 'A');
    expect(c.heroes).toHaveLength(8);
    expect(typeof recruit(c, 'archer', 'B')).toBe('string');
  });

  it('a squad holds at most 4 heroes', () => {
    const c = newCampaign([], fixed);
    toggleSquad(c, c.heroes[5].id);
    expect(c.squad).toHaveLength(4);
    toggleSquad(c, c.squad[0]);
    toggleSquad(c, c.heroes[5].id);
    expect(c.squad).toContain(c.heroes[5].id);
  });

  it('never leaves you stuck: free recruits refill the squad to 4 when gold is short', () => {
    const c = newCampaign([], fixed);
    c.heroes = c.heroes.slice(0, 1);
    c.gold = 10;
    const added = ensureSquad(c, fixed);
    expect(added).toHaveLength(3);
    expect(c.heroes).toHaveLength(4);
    expect(c.squad).toHaveLength(4);
  });

  it('promotes only at level 3, to one of the class\'s own paths, once', () => {
    const c = newCampaign([], fixed);
    const k = c.heroes.find(h => h.cls === 'knight')!;
    expect(promote(c, k.id, 'paladin')).toBe(false);
    k.xp = 7;
    expect(canPromote(k)).toBe(true);
    expect(promote(c, k.id, 'pyromancer')).toBe(false);
    expect(promote(c, k.id, 'paladin')).toBe(true);
    expect(promote(c, k.id, 'berserker')).toBe(false);
    expect(squadMembers(c).find(m => m.heroId === k.id)).toMatchObject({ path: 'paladin', level: 3 });
  });
});

describe('after a campaign battle', () => {
  function finished(won: boolean) {
    const c = newCampaign([], fixed);
    const s = createGame({ seed: 3, diff: 'easy', theme: 'forest', squad: squadMembers(c), mode: 'campaign' });
    const [a, b] = living(s, 'hero');
    a.kills = 2;
    b.alive = false;
    b.hp = 0;
    const gobs = living(s, 'gob');
    gobs.slice(0, won ? gobs.length : 2).forEach(g => { g.alive = false; });
    if (!won) living(s, 'hero').forEach(h => { h.alive = false; });
    s.phase = 'over';
    s.winner = won ? 'hero' : 'gob';
    return { c, s, a, b };
  }

  it('survivors earn XP, the fallen are gone for good, and a win pays gold', () => {
    const { c, s, a, b } = finished(true);
    const r = applyBattle(c, s, fixed)!;
    expect(r.won).toBe(true);
    expect(r.gold).toBe(PROGRESS.gold.win + r.goblins * PROGRESS.gold.perGoblin);
    expect(c.gold).toBe(r.gold);
    const ra = r.heroes.find(h => h.id === a.heroId)!;
    expect(ra.xp).toBe(2 * PROGRESS.xpPerDefeat + PROGRESS.xpForSurviving);
    expect(c.heroes.find(h => h.id === a.heroId)!.xp).toBe(4);
    expect(c.heroes.some(h => h.id === b.heroId)).toBe(false);
    expect(c.fallen).toHaveLength(1);
    expect(c.fallen[0]).toMatchObject({ name: b.name, place: 'the Dark Forest', battle: 1 });
    expect(c.squad).not.toContain(b.heroId);
    // The same battle is never counted twice
    expect(applyBattle(c, s, fixed)).toBeNull();
  });

  it('a loss still pays a little, and free recruits refill the squad', () => {
    const { c, s } = finished(false);
    const r = applyBattle(c, s, fixed)!;
    expect(r.gold).toBe(PROGRESS.gold.loss);
    expect(c.fallen).toHaveLength(4);
    expect(c.heroes.length).toBeGreaterThanOrEqual(4);
    expect(c.squad).toHaveLength(4);
  });

  it('practice battles change nothing', () => {
    const c = newCampaign([], fixed);
    const s = createGame({ seed: 3, diff: 'easy', theme: 'village', squad: squadMembers(c), mode: 'practice' });
    s.phase = 'over';
    s.winner = 'gob';
    expect(applyBattle(c, s, fixed)).toBeNull();
    expect(c.heroes).toHaveLength(6);
  });

  it('defeats count for the hero who landed them (a Turret\'s for its Builder)', () => {
    const s = blank();
    const b = hero(s, 'builder', 5, 10, undefined, 1);
    const g = put(s, 'grunt', 'gob', 5, 6, 1);
    performAbility(s, b, 5, 8, 2);
    s.rng = { s: 1 } as never;
    for (let i = 0; i < 10 && g.alive; i++) { s.phase = 'player'; endPlayerTurn(s); }
    expect(g.alive).toBe(false);
    expect(b.kills).toBe(1);
  });
});

describe('Tier 2 paths', () => {
  it('Paladin: friends next to him take 1 less damage', () => {
    const s = blank();
    const p = hero(s, 'knight', 5, 10, 'paladin');
    const a = hero(s, 'archer', 6, 10);
    const g = put(s, 'grunt', 'gob', 6, 9);
    expect(hitInfo(s, g, a).dmg).toBe(1);
    p.x = 1;
    expect(hitInfo(s, g, a).dmg).toBe(2);
  });

  it('Paladin: Lay on Hands heals a friend next to him and keeps an action', () => {
    const s = blank();
    const p = hero(s, 'knight', 5, 10, 'paladin');
    const a = hero(s, 'archer', 5, 11);
    a.hp = 1;
    expect(abilityTargets(s, p)).toEqual([[5, 11]]);
    performAbility(s, p, 5, 11);
    expect(a.hp).toBe(3);
    expect(p.ap).toBe(1);
  });

  it('Berserker: Whirlwind hits all 8 tiles around for 4', () => {
    const s = blank();
    const b = hero(s, 'knight', 5, 10, 'berserker');
    const g1 = put(s, 'grunt', 'gob', 6, 11);
    const g2 = put(s, 'troll', 'gob', 4, 9);
    performAbility(s, b, 5, 10);
    expect(g1.alive).toBe(false);
    expect(g2.hp).toBe(g2.maxHp - 4);
    expect(def(b).dmg).toBe(4);
  });

  it('Sharpshooter: ignores low walls and Aimed Shot doubles damage', () => {
    const s = blank();
    const a = hero(s, 'archer', 5, 12, 'sharpshooter');
    const g = put(s, 'troll', 'gob', 5, 6);
    wall(s, 5, 7, 'stone');
    const plain = blank();
    const a2 = put(plain, 'archer', 'hero', 5, 12);
    const g2 = put(plain, 'troll', 'gob', 5, 6);
    wall(plain, 5, 7, 'stone');
    expect(hitInfo(s, a, g).chance).toBeGreaterThan(hitInfo(plain, a2, g2).chance);
    s.rng = { s: 3 } as never;
    const before = g.hp;
    performAbility(s, a, 5, 6);
    expect([before - 4, before - 1]).toContain(g.hp);
  });

  it('Ranger: a Snare stops a goblin and hurts it, and she is hard to spot near bushes', () => {
    const s = blank();
    const r = hero(s, 'archer', 5, 12, 'ranger');
    const g = put(s, 'grunt', 'gob', 5, 6);
    performAbility(s, r, 5, 9);
    expect(s.tiles[9][5].trap).toBe(r.id);
    performMove(s, g, [{ x: 5, z: 7 }, { x: 5, z: 8 }, { x: 5, z: 9 }, { x: 5, z: 10 }]);
    expect(g.z).toBe(9);
    expect(g.hp).toBe(g.maxHp - BALANCE.snare.damage);
    expect(s.tiles[9][5].trap).toBeUndefined();
    expect(canSee(s, 'gob', r)).toBe(true);
    wall(s, 6, 12, 'bush');
    expect(canSee(s, 'gob', r)).toBe(false);
  });

  it('Pyromancer: Fireball does 3 and Firebolt hits set the ground alight', () => {
    const s = blank();
    const m = hero(s, 'mage', 5, 12, 'pyromancer');
    const g = put(s, 'troll', 'gob', 5, 8);
    s.rng = { s: 1 } as never;
    for (let i = 0; i < 20 && !s.tiles[8][5].fire; i++) { m.ap = 2; performAttack(s, m, g); }
    expect(s.tiles[8][5].fire).toBeGreaterThan(0);
    const g2 = put(s, 'troll', 'gob', 9, 9);
    const hp = g2.hp;
    m.ap = 2; m.cd = 0;
    performAbility(s, m, 9, 9);
    expect(g2.hp).toBe(hp - 3);
  });

  it('Frost Mage: Ice Wall raises 3 tall ice blocks that melt after 3 turns', () => {
    const s = blank();
    const m = hero(s, 'mage', 5, 12, 'frostmage');
    put(s, 'grunt', 'gob', 1, 1);
    expect(iceWallCells(s, m, 5, 9)).toHaveLength(3);
    performAbility(s, m, 5, 9, 2);
    expect(m.ap).toBe(1);
    for (const x of [4, 5, 6]) expect(s.tiles[9][x].blocks).toEqual(['ice', 'ice']);
    for (let i = 0; i < 3; i++) { endPlayerTurn(s); endEnemyTurn(s); }
    expect(s.tiles[9][5].blocks).toEqual([]);
  });

  it('Frost Mage: a frozen goblin skips its next turn', () => {
    const s = blank();
    const m = hero(s, 'mage', 5, 12, 'frostmage');
    const g = put(s, 'troll', 'gob', 5, 9);
    for (let i = 0; i < 30 && !g.frozen; i++) { m.ap = 2; performAttack(s, m, g); }
    expect(g.frozen).toBe(true);
    endPlayerTurn(s);
    expect(g.ap).toBe(0);
    expect(g.frozen).toBe(false);
  });

  it('Demolitionist: TNT blows up after the goblins move, hitting everyone around it and its walls', () => {
    const s = blank();
    const d = hero(s, 'builder', 5, 12, 'demolitionist');
    const g = put(s, 'troll', 'gob', 6, 8);
    wall(s, 4, 8);
    performAbility(s, d, 5, 9);
    expect(unitAt(s, 5, 9)?.cls).toBe('tnt');
    endPlayerTurn(s);
    const hp = g.hp;
    endEnemyTurn(s);
    expect(g.hp).toBe(hp - BALANCE.tnt.damage);
    expect(s.tiles[8][4].blocks).toEqual([]);
    expect(unitAt(s, 5, 9)).toBeNull();
  });

  it('Demolitionist: TNT next to TNT goes off too, and hitting it sets it off early', () => {
    const s = blank();
    const d = hero(s, 'builder', 5, 12, 'demolitionist');
    const g = put(s, 'grunt', 'gob', 3, 8);
    performAbility(s, d, 5, 9);
    performAbility(s, d, 6, 9);
    const [t1, t2] = s.units.filter(u => u.cls === 'tnt');
    g.ap = 2;
    expect(attackTargets(s, g)).toHaveLength(0);
    g.x = 5; g.z = 8;
    performAttack(s, g, t1);
    expect(t1.alive).toBe(false);
    expect(t2.alive).toBe(false);
    expect(g.alive).toBe(false);
  });

  it('Architect: an empty Watchtower shoots like a Turret, for 2', () => {
    const s = blank();
    const ar = hero(s, 'builder', 5, 12, 'architect');
    const g = put(s, 'troll', 'gob', 5, 6);
    performAbility(s, ar, 5, 10, 2);
    s.rng = { s: 2 } as never;
    const ev = endPlayerTurn(s);
    const shot = ev.find(e => e.t === 'attack');
    expect(shot).toBeTruthy();
    expect(g.hp).toBeLessThan(g.maxHp);
  });

  it('Architect: Build puts up 2 walls, and a Watchtower gives range and keeps clubs away', () => {
    const s = blank();
    const ar = hero(s, 'builder', 5, 12, 'architect');
    put(s, 'grunt', 'gob', 1, 1);
    performAbility(s, ar, 5, 11);
    expect(s.tiles[11][5].blocks).toHaveLength(2);
    expect(s.tiles[11][4].blocks.length + s.tiles[11][6].blocks.length).toBe(2);
    ar.ap = 2;
    performAbility(s, ar, 5, 13, 2);
    expect(s.tiles[13][5].tower).toBe(ar.id);
    const a = hero(s, 'archer', 5, 13);
    const far = put(s, 'garcher', 'gob', 5, 4);
    expect(canAttackFrom(s, a, far, 5, 13)).toBe(true);
    a.x = 6;
    expect(canAttackFrom(s, a, far, 6, 13)).toBe(false);
    a.x = 5;
    const club = put(s, 'grunt', 'gob', 4, 13);
    expect(canAttackFrom(s, club, a, 4, 13)).toBe(false);
    const troll = put(s, 'troll', 'gob', 6, 12);
    troll.x = 6; troll.z = 13;
    expect(canAttackFrom(s, troll, a, 6, 13)).toBe(true);
    expect(moveTiles(s, club).has('5,13')).toBe(false);
  });

  it('Priest: Heal restores 3, splashes friends, and blesses the next attack', () => {
    const s = blank();
    const p = hero(s, 'cleric', 5, 12, 'priest');
    const a = hero(s, 'archer', 5, 9);
    const k = hero(s, 'knight', 6, 9);
    const g = put(s, 'grunt', 'gob', 5, 4);
    a.hp = 1; k.hp = 2;
    const before = hitInfo(s, a, g).chance;
    performAbility(s, p, 5, 9);
    expect(a.hp).toBe(4);
    expect(k.hp).toBe(3);
    expect(a.blessed).toBe(true);
    expect(hitInfo(s, a, g).chance).toBe(Math.min(95, before + BALANCE.bless));
    performAttack(s, a, g);
    expect(a.blessed).toBe(false);
  });

  it('Frost Mage: Blizzard freezes every goblin it hits', () => {
    const s = blank();
    const m = hero(s, 'mage', 5, 12, 'frostmage');
    const g1 = put(s, 'troll', 'gob', 5, 8);
    const g2 = put(s, 'troll', 'gob', 6, 9);
    performAbility(s, m, 5, 8);
    expect([g1.frozen, g2.frozen]).toEqual([true, true]);
    expect(g1.hp).toBe(g1.maxHp - 2);
  });

  it('Druid: Vines hurt and stop goblins moving on their next turn only', () => {
    const s = blank();
    const d = hero(s, 'cleric', 5, 12, 'druid');
    const g = put(s, 'troll', 'gob', 5, 8);
    performAbility(s, d, 5, 8, 2);
    expect(g.rooted).toBe(true);
    expect(g.hp).toBe(g.maxHp - 1);
    expect(d.ap).toBe(1);
    endPlayerTurn(s);
    expect(moveTiles(s, g).size).toBe(0);
    endEnemyTurn(s);
    expect(g.rooted).toBe(false);
  });
});

describe('promoted squads in simulated battles', () => {
  it('every path can play a whole battle to the end', () => {
    const all = Object.keys(PATHS) as PathId[];
    for (let i = 0; i < all.length; i += 4) {
      const squad = all.slice(i, i + 4).map(p => ({ cls: PATHS[p].cls, name: p, path: p, level: 3 }));
      for (const theme of ['village', 'forest'] as const) {
        const r = runBattle({ seed: 40 + i, diff: 'normal', theme, squad });
        expect(['hero', 'gob', 'draw']).toContain(r.winner);
      }
    }
  });
});
