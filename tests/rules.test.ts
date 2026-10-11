import { describe, expect, it } from 'vitest';
import { BALANCE, CLASSES, DEFAULT_SQUAD } from '../app/src/rules/balance';
import { generateLayout } from '../app/src/rules/map';
import { makeRng } from '../app/src/rules/rng';
import {
  abilityTargets, attackTargets, canSee, coverAt, createGame, endEnemyTurn, endPlayerTurn, hitInfo, living, los,
  moveAttackOption, moveTiles, pathTo, performAbility, performAttack, performGuard, performMove, performMoveAttack, reach
} from '../app/src/rules/game';
import { deserialize, serialize } from '../app/src/rules/save';
import { blank, put, wall } from './helpers';

describe('maps', () => {
  it('are mirror images through the centre, so neither side has better cover', () => {
    for (const theme of ['village', 'forest'] as const) for (let seed = 1; seed <= 30; seed++) {
      const g = generateLayout(makeRng(seed), 16, theme);
      for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) expect(g[z][x]).toBe(g[15 - z][15 - x]);
    }
  });

  it('let every open tile be reached', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const s = createGame({ seed, diff: 'normal', theme: seed % 2 ? 'village' : 'forest', squad: DEFAULT_SQUAD });
      const knight = living(s, 'hero')[0];
      s.units = [knight];
      const r = reach(s, knight, 999);
      let open = 0;
      for (const row of s.tiles) for (const t of row) if (!t.blocks.length) open++;
      expect(r.size).toBe(open);
    }
  });

  it('change with the seed and are the same for the same seed', () => {
    const a = generateLayout(makeRng(1), 16, 'village').join('');
    expect(generateLayout(makeRng(1), 16, 'village').join('')).toBe(a);
    expect(generateLayout(makeRng(2), 16, 'village').join('')).not.toBe(a);
  });

  it('village maps have a well, forest maps have lots of trees', () => {
    for (let seed = 1; seed <= 10; seed++) {
      expect(generateLayout(makeRng(seed), 16, 'village').join('')).toContain('W');
      const f = generateLayout(makeRng(seed), 16, 'forest').join('');
      expect(f.split('T').length - 1).toBeGreaterThanOrEqual(12);
    }
  });

  it('new games put heroes at the bottom and the right goblins at the top', () => {
    const s = createGame({ seed: 3, diff: 'hard', theme: 'village', squad: DEFAULT_SQUAD });
    expect(living(s, 'hero').every(u => u.z >= 13)).toBe(true);
    expect(living(s, 'gob').every(u => u.z <= 2)).toBe(true);
    expect(living(s, 'gob').map(u => u.cls).sort()).toEqual([...BALANCE.difficulty.hard.roster].sort());
    expect(living(s, 'gob')[0].maxHp).toBe(CLASSES[living(s, 'gob')[0].cls].hp + BALANCE.difficulty.hard.goblinHpBonus);
  });
});

describe('movement', () => {
  it('walks around walls and other units', () => {
    const s = blank();
    const k = put(s, 'knight', 'hero', 5, 5);
    wall(s, 6, 5);
    put(s, 'grunt', 'gob', 4, 5);
    const r = moveTiles(s, k);
    expect(r.has('6,5')).toBe(false);
    expect(r.has('4,5')).toBe(false);
    expect(r.get('7,5')!.d).toBe(4);
  });

  it('a Troll smashes through walls but not wells', () => {
    const s = blank();
    const t = put(s, 'troll', 'gob', 5, 5);
    wall(s, 6, 5);
    wall(s, 5, 6, 'well');
    const r = moveTiles(s, t);
    expect(r.get('6,5')!.d).toBe(BALANCE.troll.wallStepCost);
    expect(r.has('5,6')).toBe(false);
    const ev = performMove(s, t, pathTo(r.get('7,5')!));
    expect(ev.filter(e => e.t === 'blockRemoved')).toHaveLength(2);
    expect(s.tiles[5][6].blocks).toHaveLength(0);
    expect([t.x, t.z]).toEqual([7, 5]);
  });
});

describe('shooting', () => {
  it('tall walls block line of sight, but not right next to the shooter or target', () => {
    const s = blank();
    wall(s, 5, 2);
    expect(los(s, 5, 0, 5, 6)).toBe(false);
    expect(los(s, 5, 1, 5, 6)).toBe(true);
    expect(los(s, 5, 0, 5, 3)).toBe(true);
  });

  it('cover depends on the side the shot comes from', () => {
    const s = blank();
    wall(s, 5, 6, 'stone');
    expect(coverAt(s, 5, 5, 5, 10)).toBe(1);
    expect(coverAt(s, 5, 5, 5, 0)).toBe(0);
    wall(s, 5, 6);
    expect(coverAt(s, 5, 5, 5, 10)).toBe(2);
  });

  it('hit chance uses aim, cover, open-shot bonus and range', () => {
    const s = blank();
    const a = put(s, 'archer', 'hero', 5, 10);
    const g = put(s, 'grunt', 'gob', 5, 5);
    expect(hitInfo(s, a, g).chance).toBe(Math.min(95, CLASSES.archer.aim + BALANCE.openShotBonus));
    wall(s, 5, 6, 'stone');
    expect(hitInfo(s, a, g).chance).toBe(CLASSES.archer.aim - BALANCE.coverPenalty.half);
    const far = put(s, 'grunt', 'gob', 5, 3);
    expect(hitInfo(s, a, far).chance).toBe(Math.min(95, CLASSES.archer.aim + BALANCE.openShotBonus - 2 * BALANCE.longRange.penaltyPerTile));
  });

  it('a hit does full damage and a miss grazes', () => {
    let hits = 0, grazes = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const s = blank({ seed });
      const a = put(s, 'mage', 'hero', 5, 10);
      const g = put(s, 'troll', 'gob', 5, 6, 10);
      const ev = performAttack(s, a, g);
      const att = ev.find(e => e.t === 'attack')!;
      if (att.t === 'attack' && att.hit) { hits++; expect(g.hp).toBe(10 - CLASSES.mage.dmg); } else { grazes++; expect(g.hp).toBe(10 - BALANCE.graze); }
      expect(a.ap).toBe(0);
    }
    expect(hits).toBeGreaterThan(150);
    expect(grazes).toBeGreaterThan(5);
  });

  it('attacks are repeatable with the same seed', () => {
    const run = () => { const s = blank({ seed: 42 }); const a = put(s, 'archer', 'hero', 5, 10); const g = put(s, 'grunt', 'gob', 5, 5); return JSON.stringify(performAttack(s, a, g)); };
    expect(run()).toBe(run());
  });

  it('move-then-attack picks a tile and attacks with the second action', () => {
    const s = blank();
    const k = put(s, 'knight', 'hero', 5, 10);
    const g = put(s, 'grunt', 'gob', 5, 6);
    expect(attackTargets(s, k)).toHaveLength(0);
    const opt = moveAttackOption(s, k, g)!;
    expect(opt).not.toBeNull();
    performMoveAttack(s, k, pathTo(opt.node), g);
    expect(k.ap).toBe(0);
    expect(g.hp).toBeLessThan(3);
  });
});

describe('overwatch', () => {
  it('a guarding unit shoots the first enemy that moves in sight', () => {
    const s = blank({ seed: 3 });
    const a = put(s, 'archer', 'hero', 5, 12);
    performGuard(s, a);
    const g = put(s, 'grunt', 'gob', 5, 2, 10);
    endPlayerTurn(s);
    expect(a.guard).toBe(true);
    const ev = performMove(s, g, [{ x: 5, z: 3 }, { x: 5, z: 4 }, { x: 5, z: 5 }]);
    const shot = ev.filter(e => e.t === 'attack');
    expect(shot).toHaveLength(1);
    if (shot[0].t === 'attack') expect(shot[0].overwatch).toBe(true);
    expect(a.guard).toBe(false);
    expect(g.hp).toBeLessThan(10);
  });
});

describe('overwatch interruptions', () => {
  it('getting attacked knocks a unit off Overwatch', () => {
    const s = blank();
    const a = put(s, 'archer', 'hero', 5, 6, 10);
    performGuard(s, a);
    endPlayerTurn(s);
    const g = put(s, 'grunt', 'gob', 5, 5);
    performAttack(s, g, a);
    expect(a.guard).toBe(false);
  });

  it('an Overwatch hit stops the mover about half the time, a graze never does', () => {
    let hits = 0, stoppedHits = 0, stoppedMisses = 0;
    for (let seed = 1; seed <= 400; seed++) {
      const s = blank({ seed });
      const a = put(s, 'archer', 'hero', 8, 10);
      performGuard(s, a);
      endPlayerTurn(s);
      const g = put(s, 'troll', 'gob', 8, 2, 50);
      const ev = performMove(s, g, [{ x: 8, z: 3 }, { x: 8, z: 4 }, { x: 8, z: 5 }]);
      const shot = ev.find(e => e.t === 'attack');
      if (!shot || shot.t !== 'attack') continue;
      const stopped = g.z !== 5;
      expect(stopped).toBe(ev.some(e => e.t === 'pinned'));
      if (shot.hit) { hits++; if (stopped) stoppedHits++; } else if (stopped) stoppedMisses++;
    }
    expect(hits).toBeGreaterThan(100);
    expect(stoppedHits / hits).toBeGreaterThan(0.4);
    expect(stoppedHits / hits).toBeLessThan(0.6);
    expect(stoppedMisses).toBe(0);
  });

  it('a hero stopped during move-then-attack does not attack and keeps one action', () => {
    let checked = 0;
    for (let seed = 1; seed <= 200 && checked < 5; seed++) {
      const s = blank({ seed });
      const g = put(s, 'garcher', 'gob', 5, 6, 50);
      performGuard(s, g);
      const target = put(s, 'grunt', 'gob', 9, 6, 50);
      const k = put(s, 'knight', 'hero', 9, 10);
      const ev = performMoveAttack(s, k, [{ x: 9, z: 9 }, { x: 9, z: 8 }, { x: 9, z: 7 }], target);
      if (!ev.some(e => e.t === 'pinned')) continue;
      checked++;
      expect(k.ap).toBe(1);
      expect(target.hp).toBe(50);
    }
    expect(checked).toBeGreaterThan(0);
  });
});

describe('abilities', () => {
  it('Spin Attack hits every goblin next to the Knight', () => {
    const s = blank();
    const k = put(s, 'knight', 'hero', 5, 5);
    const g1 = put(s, 'grunt', 'gob', 6, 5, 5), g2 = put(s, 'grunt', 'gob', 5, 4, 5), g3 = put(s, 'grunt', 'gob', 8, 5, 5);
    performAbility(s, k, 5, 5);
    expect([g1.hp, g2.hp, g3.hp]).toEqual([3, 3, 5]);
    expect(k.cd).toBe(CLASSES.knight.ability!.cd);
  });

  it('Fireball damages an area, destroys blocks and starts fires', () => {
    const s = blank();
    const m = put(s, 'mage', 'hero', 5, 10);
    const g = put(s, 'grunt', 'gob', 5, 6, 5);
    wall(s, 6, 6, 'stone');
    wall(s, 7, 6, 'hay');
    wall(s, 5, 5, 'well');
    const ev = performAbility(s, m, 5, 6);
    expect(g.hp).toBe(3);
    expect(s.tiles[6][6].blocks).toHaveLength(0);
    expect(s.tiles[6][5].fire).toBe(BALANCE.fire.groundRounds);
    expect(s.tiles[6][7].fire).toBe(BALANCE.fire.blockRounds);
    expect(s.tiles[5][5].blocks).toEqual(['well']);
    expect(ev.some(e => e.t === 'fire' && e.on)).toBe(true);
  });

  it('fire burns units standing in it, burns wood away and goes out', () => {
    const s = blank();
    put(s, 'knight', 'hero', 0, 15);
    const g = put(s, 'grunt', 'gob', 3, 3, 5);
    s.tiles[3][3].fire = 1;
    wall(s, 9, 9, 'hay');
    s.tiles[9][9].fire = 2;
    endPlayerTurn(s);
    endEnemyTurn(s);
    expect(g.hp).toBe(5 - BALANCE.fire.burnDamage);
    expect(s.tiles[3][3].fire).toBe(0);
    expect(s.tiles[9][9].blocks).toHaveLength(0);
    expect(s.tiles[9][9].fire).toBe(1);
  });

  it('walking through fire hurts', () => {
    const s = blank();
    const k = put(s, 'knight', 'hero', 5, 5, 6);
    s.tiles[5][6].fire = 2;
    performMove(s, k, [{ x: 6, z: 5 }, { x: 7, z: 5 }]);
    expect(k.hp).toBe(6 - BALANCE.fire.burnDamage);
  });

  it('standing next to a well heals at the start of the turn', () => {
    const s = blank();
    const k = put(s, 'knight', 'hero', 5, 5, 6);
    k.hp = 3;
    put(s, 'grunt', 'gob', 0, 0);
    wall(s, 6, 6, 'well');
    endPlayerTurn(s);
    endEnemyTurn(s);
    expect(k.hp).toBe(3 + BALANCE.well.heal);
  });

  it('Cleric heals a wounded friend in range, never above full', () => {
    const s = blank();
    const c = put(s, 'cleric', 'hero', 5, 5);
    const k = put(s, 'knight', 'hero', 5, 8);
    k.hp = 5;
    expect(abilityTargets(s, c)).toEqual([[5, 8]]);
    performAbility(s, c, 5, 8);
    expect(k.hp).toBe(6);
  });

  it('Shaman summons up to two goblins', () => {
    const s = blank();
    const sh = put(s, 'shaman', 'gob', 5, 5);
    performAbility(s, sh, 6, 5);
    sh.ap = 2; sh.cd = 0;
    performAbility(s, sh, 4, 5);
    sh.ap = 2; sh.cd = 0;
    expect(abilityTargets(s, sh)).toHaveLength(0);
    expect(living(s, 'gob')).toHaveLength(3);
    expect(living(s, 'gob')[1].hp).toBe(BALANCE.shaman.summonHp);
  });

  it('Build costs one action and makes a low wall tall', () => {
    const s = blank();
    const b = put(s, 'builder', 'hero', 5, 5);
    performAbility(s, b, 5, 4);
    expect(b.ap).toBe(1);
    performAbility(s, b, 5, 4);
    expect(s.tiles[4][5].blocks).toHaveLength(2);
    expect(abilityTargets(s, b).some(([x, z]) => x === 5 && z === 4)).toBe(false);
  });
});

describe('forest fog', () => {
  it('hides goblins far from every hero', () => {
    const s = blank({ theme: 'forest' });
    put(s, 'archer', 'hero', 5, 12);
    const near = put(s, 'grunt', 'gob', 5, 9), far = put(s, 'grunt', 'gob', 5, 4);
    expect(canSee(s, 'hero', near)).toBe(true);
    expect(canSee(s, 'hero', far)).toBe(false);
    expect(attackTargets(s, s.units[0]).map(u => u.id)).toEqual([near.id]);
  });
});

describe('saving', () => {
  it('a saved game resumes exactly, including future dice rolls', () => {
    const s = createGame({ seed: 9, diff: 'normal', theme: 'village', squad: DEFAULT_SQUAD });
    const copy = deserialize(serialize(s))!;
    expect(copy).toEqual(s);
    const a = living(s, 'hero')[0], b = living(copy, 'hero')[0];
    const ta = living(s, 'gob')[0], tb = living(copy, 'gob')[0];
    a.x = ta.x; a.z = ta.z + 1; b.x = tb.x; b.z = tb.z + 1;
    expect(JSON.stringify(performAttack(s, a, ta))).toBe(JSON.stringify(performAttack(copy, b, tb)));
  });

  it('ignores broken or old saves', () => {
    expect(deserialize(null)).toBeNull();
    expect(deserialize('nonsense')).toBeNull();
    expect(deserialize('{"v":0,"s":{}}')).toBeNull();
  });
});
