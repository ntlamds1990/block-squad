import { describe, expect, it } from 'vitest';
import { chooseAction, runUnitTurn } from '../app/src/rules/ai';
import { runBattle } from '../app/src/rules/sim';
import { blank, put } from './helpers';

describe('CPU', () => {
  it('finishes off a wounded enemy in reach', () => {
    const s = blank();
    const g = put(s, 'grunt', 'gob', 5, 5);
    const h = put(s, 'archer', 'hero', 5, 6, 4);
    h.hp = 1;
    s.phase = 'enemy';
    expect(chooseAction(s, g, { noise: 0 })).toEqual({ k: 'attack', target: h.id });
  });

  it('a Shaman heals a badly hurt goblin', () => {
    const s = blank();
    const sh = put(s, 'shaman', 'gob', 5, 2);
    const t = put(s, 'troll', 'gob', 5, 4);
    t.hp = 2;
    put(s, 'knight', 'hero', 5, 14);
    s.phase = 'enemy';
    expect(chooseAction(s, sh, { noise: 0 })).toEqual({ k: 'shamanHeal', target: t.id });
  });

  it('never walks into fire when it has a choice', () => {
    const s = blank();
    const g = put(s, 'grunt', 'gob', 5, 2);
    put(s, 'knight', 'hero', 5, 12);
    for (let x = 0; x < 16; x++) s.tiles[4][x].fire = x === 0 ? 0 : 2;
    s.phase = 'enemy';
    runUnitTurn(s, g, { noise: 0 });
    expect(g.hp).toBe(g.maxHp);
  });

  it('every battle ends, on every difficulty and theme', () => {
    for (const diff of ['easy', 'normal', 'hard'] as const) for (const theme of ['village', 'forest'] as const) for (let seed = 1; seed <= 4; seed++) {
      const r = runBattle({ seed, diff, theme });
      expect(['hero', 'gob', 'draw']).toContain(r.winner);
      expect(r.turns).toBeLessThanOrEqual(41);
      // No two living units ever share a tile, and nobody stands inside a block
      const seen = new Set<string>();
      for (const u of r.state.units.filter(u => u.alive)) {
        expect(seen.has(u.x + ',' + u.z)).toBe(false);
        seen.add(u.x + ',' + u.z);
        expect(r.state.tiles[u.z][u.x].blocks.length).toBe(0);
      }
    }
  });

  it('battles are repeatable with the same seed', () => {
    const a = runBattle({ seed: 11, diff: 'normal', theme: 'forest' });
    const b = runBattle({ seed: 11, diff: 'normal', theme: 'forest' });
    expect(a.winner).toBe(b.winner);
    expect(a.turns).toBe(b.turns);
  });
});
