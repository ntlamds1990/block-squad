import type { Mat, Theme, Tile } from './types';
import { type Rng, next, rint } from './rng';

// Map letters: . grass  f fence  h hay  s low stone  S tall stone  C cottage  T tree  W well
//              b bush  l fallen log  R big rock
const KIND_BLOCKS: Record<string, Mat[]> = {
  '.': [], f: ['plank2'], h: ['hay'], s: ['stone'], S: ['stone', 'stone'], C: ['plank', 'roof'],
  T: ['log', 'leaves'], W: ['well'], b: ['bush'], l: ['log'], R: ['stone', 'stone']
};

interface Piece { w: number; h: number; ch: string; count: [number, number]; zMin: number; long?: boolean }

const RECIPES: Record<Theme, Piece[]> = {
  village: [
    { w: 2, h: 2, ch: 'C', count: [1, 2], zMin: 3 },
    { w: 3, h: 1, ch: 'S', count: [1, 2], zMin: 3, long: true },
    { w: 3, h: 1, ch: 'f', count: [2, 3], zMin: 3, long: true },
    { w: 2, h: 1, ch: 'h', count: [1, 2], zMin: 3, long: true },
    { w: 1, h: 1, ch: 'W', count: [1, 1], zMin: 4 },
    { w: 1, h: 1, ch: 's', count: [2, 3], zMin: 3 },
    { w: 1, h: 1, ch: 'T', count: [2, 4], zMin: 2 }
  ],
  forest: [
    { w: 1, h: 1, ch: 'T', count: [9, 13], zMin: 2 },
    { w: 2, h: 1, ch: 'b', count: [3, 5], zMin: 2, long: true },
    { w: 3, h: 1, ch: 'l', count: [1, 2], zMin: 3, long: true },
    { w: 2, h: 2, ch: 'R', count: [0, 1], zMin: 3 },
    { w: 1, h: 1, ch: 's', count: [1, 3], zMin: 3 },
    { w: 1, h: 1, ch: 'W', count: [1, 1], zMin: 4 }
  ]
};

// Build the goblin half at random, mirror it through the centre so both sides get the same cover,
// and retry until every open tile is reachable.
export function generateLayout(rng: Rng, size: number, theme: Theme): string[] {
  const half = size / 2;
  for (let attempt = 0; attempt < 80; attempt++) {
    const g: string[][] = Array.from({ length: size }, () => Array(size).fill('.'));
    const free = (x: number, z: number, w: number, h: number) => {
      for (let dz = -1; dz <= h; dz++) for (let dx = -1; dx <= w; dx++) {
        const cx = x + dx, cz = z + dz;
        if (cx < 0 || cz < 0 || cx >= size || cz >= half) continue;
        if (g[cz][cx] !== '.') return false;
      }
      return true;
    };
    const tryPlace = (w: number, h: number, ch: string, zMin: number) => {
      for (let i = 0; i < 50; i++) {
        const x = Math.floor(next(rng) * (size - w + 1));
        const z = zMin + Math.floor(next(rng) * Math.max(1, half - h - zMin + 1));
        if (z + h > half) continue;
        if (!free(x, z, w, h)) continue;
        for (let dz = 0; dz < h; dz++) for (let dx = 0; dx < w; dx++) g[z + dz][x + dx] = ch;
        return true;
      }
      return false;
    };
    for (const p of RECIPES[theme]) {
      for (let n = rint(rng, p.count[0], p.count[1]); n > 0; n--) {
        if (p.long) {
          const len = rint(rng, Math.max(2, p.w - 1), p.w + 1);
          if (next(rng) < 0.55) tryPlace(len, 1, p.ch, p.zMin); else tryPlace(1, len, p.ch, p.zMin);
        } else tryPlace(p.w, p.h, p.ch, p.zMin);
      }
    }
    if (next(rng) < 0.7) g[0][0] = 'T';
    if (next(rng) < 0.7) g[0][size - 1] = 'T';
    for (let z = 0; z < half; z++) for (let x = 0; x < size; x++) g[size - 1 - z][size - 1 - x] = g[z][x];
    if (allOpenConnected(g)) return g.map(r => r.join(''));
  }
  return Array.from({ length: size }, () => '.'.repeat(size));
}

function allOpenConnected(g: string[][]): boolean {
  const size = g.length;
  let open = 0;
  let start: [number, number] | null = null;
  for (let z = 0; z < size; z++) for (let x = 0; x < size; x++) if (g[z][x] === '.') { open++; if (!start) start = [x, z]; }
  if (!start) return false;
  const seen = new Set([start.join()]);
  const q: [number, number][] = [start];
  while (q.length) {
    const [x, z] = q.shift()!;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, nz = z + dz;
      if (nx < 0 || nz < 0 || nx >= size || nz >= size || g[nz][nx] !== '.' || seen.has(nx + ',' + nz)) continue;
      seen.add(nx + ',' + nz);
      q.push([nx, nz]);
    }
  }
  return seen.size === open;
}

export function layoutToTiles(layout: string[]): Tile[][] {
  return layout.map((row, z) => row.split('').map((ch, x) => ({ x, z, blocks: [...(KIND_BLOCKS[ch] || [])], fire: 0 })));
}
