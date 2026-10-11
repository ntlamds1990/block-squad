// 16x16 pixel-art textures drawn in code, so the game needs no image files.
import * as THREE from 'three';

function rng(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const R = rng(7);
const pick = <T,>(a: T[]) => a[Math.floor(R() * a.length)];

const PAL: Record<string, string[]> = {
  grass: ['#5fa83a', '#68b443', '#559a33', '#73bd4b', '#62ad3d'],
  forestGrass: ['#3f7a2c', '#467f31', '#3a7028', '#4c8a36', '#356526'],
  dirt: ['#8a5a36', '#7a4e2e', '#94653f', '#6e4529'],
  stone: ['#8d8d8d', '#7c7c7c', '#969696', '#727272'],
  plank: ['#b0814a', '#a2763f', '#bb8c55'],
  plank2: ['#cfa266', '#c4975b', '#d8ad72'],
  hay: ['#e2c048', '#d4b03c', '#ecd05a'],
  log: ['#6b4a2b', '#5a3d22', '#76532f'],
  leaves: ['#3f8f2f', '#357d27', '#4a9e38', '#2e6e22'],
  bush: ['#2f6e2a', '#3a7d31', '#285f24', '#448a39'],
  roof: ['#b5462f', '#a23d29', '#c4553b'],
  water: ['#3d7fd1', '#4a8fe0', '#3572c2', '#5a9ce8']
};

type G = CanvasRenderingContext2D;
function makeTex(draw: (g: G) => void): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 16;
  const g = c.getContext('2d')!;
  draw(g);
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  return t;
}
function fill(g: G, pal: string[]) {
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) { g.fillStyle = pick(pal); g.fillRect(x, y, 1, 1); }
}
function planks(g: G, pal: string[], dark: string) {
  fill(g, pal);
  g.fillStyle = dark;
  for (let y = 3; y < 16; y += 4) g.fillRect(0, y, 16, 1);
  for (let r = 0; r < 4; r++) g.fillRect((r * 5 + 3) % 16, r * 4, 1, 3);
}
function grassSide(g: G, grass: string[]) {
  fill(g, PAL.dirt);
  for (let x = 0; x < 16; x++) {
    const d = 3 + Math.floor(R() * 2);
    for (let y = 0; y < d; y++) { g.fillStyle = pick(grass); g.fillRect(x, y, 1, 1); }
  }
}

export const TEX = {
  grassTop: makeTex(g => fill(g, PAL.grass)),
  forestTop: makeTex(g => { fill(g, PAL.forestGrass); g.fillStyle = '#5a4a2a'; for (let i = 0; i < 6; i++) g.fillRect(Math.floor(R() * 16), Math.floor(R() * 16), 1, 1); }),
  dirt: makeTex(g => fill(g, PAL.dirt)),
  grassSide: makeTex(g => grassSide(g, PAL.grass)),
  forestSide: makeTex(g => grassSide(g, PAL.forestGrass)),
  stone: makeTex(g => { fill(g, PAL.stone); g.fillStyle = '#5e5e5e'; for (let i = 0; i < 12; i++) g.fillRect(Math.floor(R() * 15), Math.floor(R() * 16), 2, 1); }),
  cobble: makeTex(g => {
    fill(g, PAL.stone);
    g.fillStyle = '#545454';
    for (let y = 0; y < 16; y += 4) { g.fillRect(0, y, 16, 1); for (let x = ((y / 4) % 2) * 3; x < 16; x += 6) g.fillRect(x, y, 1, 4); }
  }),
  plank: makeTex(g => planks(g, PAL.plank, '#6e4a24')),
  plank2: makeTex(g => planks(g, PAL.plank2, '#8a6232')),
  hay: makeTex(g => {
    fill(g, PAL.hay);
    g.fillStyle = '#b8942c';
    for (let x = 1; x < 16; x += 3) for (let y = 0; y < 16; y++) if (R() < 0.5) g.fillRect(x, y, 1, 1);
    g.fillStyle = '#9c7a22'; g.fillRect(0, 5, 16, 1); g.fillRect(0, 11, 16, 1);
  }),
  log: makeTex(g => { fill(g, PAL.log); g.fillStyle = '#4a321b'; for (let x = 0; x < 16; x += 3) for (let y = 0; y < 16; y++) if (R() < 0.6) g.fillRect(x, y, 1, 1); }),
  leaves: makeTex(g => { fill(g, PAL.leaves); g.fillStyle = '#24581b'; for (let i = 0; i < 30; i++) g.fillRect(Math.floor(R() * 16), Math.floor(R() * 16), 1, 1); }),
  bush: makeTex(g => {
    fill(g, PAL.bush);
    g.fillStyle = '#1d4a1a'; for (let i = 0; i < 24; i++) g.fillRect(Math.floor(R() * 16), Math.floor(R() * 16), 1, 1);
    g.fillStyle = '#d14a5a'; for (let i = 0; i < 5; i++) g.fillRect(Math.floor(R() * 15), Math.floor(R() * 15), 1, 1);
  }),
  roof: makeTex(g => { for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) { g.fillStyle = y % 4 === 3 ? '#7e2c1c' : pick(PAL.roof); g.fillRect(x, y, 1, 1); } }),
  water: makeTex(g => { fill(g, PAL.water); g.fillStyle = '#9cc8f5'; for (let i = 0; i < 6; i++) g.fillRect(Math.floor(R() * 14), Math.floor(R() * 16), 2, 1); })
};

export type TexKey = keyof typeof TEX;
export const MAT = Object.fromEntries(
  Object.entries(TEX).map(([k, t]) => [k, new THREE.MeshLambertMaterial({ map: t })])
) as Record<TexKey, THREE.MeshLambertMaterial>;

export const BLOCK_COLOR: Record<string, string> = {
  stone: '#8d8d8d', cobble: '#808080', plank: '#a2763f', plank2: '#c4975b', hay: '#e2c048', log: '#6b4a2b',
  leaves: '#3f8f2f', roof: '#b5462f', bush: '#2f6e2a', well: '#8d8d8d'
};
