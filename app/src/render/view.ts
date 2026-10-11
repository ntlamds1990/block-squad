// The 3D battlefield. It draws whatever the game state says and plays the rules' events as
// animations. It never changes the game state itself.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { BALANCE, CLASSES, type ClassId } from '../rules/balance';
import type { GameEvent, GameState, Mat, Theme, Unit } from '../rules/types';
import { MAT, BLOCK_COLOR } from './textures';
import { buildModel } from './models';
import { play, type Sfx } from '../ui/audio';

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

export interface UnitView {
  id: string; team: 'hero' | 'gob'; cls: ClassId; name: string;
  group: THREE.Group; body: THREE.Group; mats: THREE.MeshLambertMaterial[]; label: HTMLDivElement;
  x: number; z: number; hp: number; maxHp: number; alive: boolean; guard: boolean; preview: number; hidden: boolean;
  status: string; // small icons: frozen, rooted, blessed
}
const statusOf = (u: Unit) => (u.frozen ? '❄️' : '') + (u.rooted ? '🌿' : '') + (u.blessed ? '✨' : '');

interface Tween { t: number; dur: number; fn: (k: number) => void; res: () => void }
interface Particle { m: THREE.Mesh; v: THREE.Vector3; life: number; age: number }
interface Float { el: HTMLDivElement; pos: THREE.Vector3; age: number; life: number }
interface FireFx { group: THREE.Group; x: number; z: number; cubes: THREE.Mesh[] }

const blockGeo = new THREE.BoxGeometry(1, 1, 1);
const groundGeo = new THREE.BoxGeometry(1, 0.4, 1);
const hlGeo = new THREE.PlaneGeometry(0.92, 0.92);
const fogGeo = new THREE.PlaneGeometry(1, 1);
const fireGeo = new THREE.BoxGeometry(0.22, 0.22, 0.22);
const fireMats = [0xff8a3d, 0xffd23a, 0xff5a2a].map(c => new THREE.MeshBasicMaterial({ color: c }));
const fogMat = new THREE.MeshBasicMaterial({ color: 0x050a08, transparent: true, opacity: 0.55, depthWrite: false });
const iceMat = new THREE.MeshLambertMaterial({ map: MAT.ice.map, transparent: true, opacity: 0.82, emissive: new THREE.Color(0x3a6a8a), emissiveIntensity: 0.35 });
const woodMat = new THREE.MeshLambertMaterial({ map: MAT.plank.map });
const TOWER_Y = 1.05; // a hero on a Watchtower stands this high

const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const key = (x: number, z: number) => x + ',' + z;

export class View {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(42, 1, 0.1, 200);
  readonly controls: OrbitControls;
  private hemi = new THREE.HemisphereLight(0xe2f2ff, 0x6a5a40, 0.78);
  private sun = new THREE.DirectionalLight(0xfff0d0, 0.85);
  private world = new THREE.Group();
  private stacks: THREE.Mesh[][][] = [];
  private fires = new Map<string, FireFx>();
  private towers = new Map<string, THREE.Group>();
  private traps = new Map<string, THREE.Group>();
  private pickables: THREE.Object3D[] = [];
  private hlPool: THREE.Mesh[] = [];
  private hlUsed = 0;
  private fogPool: THREE.Mesh[] = [];
  private tweens: Tween[] = [];
  private particles: Particle[] = [];
  private floats: Float[] = [];
  private shake = 0;
  private clock = new THREE.Clock();
  private tmp = new THREE.Vector3();
  private selRing: THREE.Mesh;
  private size = 16;
  theme: Theme = 'village';
  units = new Map<string, UnitView>();
  selected: string | null = null;
  inspected: string | null = null;
  onTap: (x: number, z: number) => void = () => {};

  constructor(private app: HTMLElement, private canvas: HTMLCanvasElement, private labels: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene.fog = new THREE.Fog(0xcfe9f7, 40, 80);
    const c = this.controls = new OrbitControls(this.camera, canvas);
    c.enableDamping = true;
    c.dampingFactor = 0.12;
    c.minDistance = 7;
    c.maxDistance = 34;
    c.minPolarAngle = 0.3;
    c.maxPolarAngle = 1.22;
    c.screenSpacePanning = false;
    c.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_ROTATE };
    c.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
    this.scene.add(this.hemi);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    Object.assign(this.sun.shadow.camera, { left: -14, right: 14, top: 14, bottom: -14, near: 1, far: 70 });
    this.sun.shadow.bias = -0.0008;
    this.scene.add(this.sun, this.sun.target);
    this.selRing = new THREE.Mesh(new THREE.RingGeometry(0.44, 0.54, 28), new THREE.MeshBasicMaterial({ color: 0xf2c14e, side: THREE.DoubleSide }));
    this.selRing.rotation.x = -Math.PI / 2;
    this.selRing.visible = false;
    this.scene.add(this.selRing);
    this.scene.add(this.world);
    this.setupPicking();
    window.addEventListener('resize', () => { this.resize(); this.fitCamera(); });
    this.resize();
    this.frame();
  }

  /* ---------- Building the world ---------- */

  load(s: GameState) {
    this.size = s.size;
    this.theme = s.theme;
    const mid = (s.size - 1) / 2;
    this.scene.remove(this.world);
    this.world = new THREE.Group();
    this.scene.add(this.world);
    this.pickables = [];
    this.labels.innerHTML = '';
    this.floats = [];
    this.units.clear();
    this.fires.clear();
    this.towers.clear();
    this.traps.clear();
    this.tweens.forEach(t => t.res());
    this.tweens = [];
    const forest = s.theme === 'forest';
    this.app.classList.toggle('forest', forest);
    (this.scene.fog as THREE.Fog).color.set(forest ? 0x22301f : 0xcfe9f7);
    (this.scene.fog as THREE.Fog).near = forest ? 26 : 40;
    (this.scene.fog as THREE.Fog).far = forest ? 60 : 80;
    this.hemi.intensity = forest ? 0.55 : 0.78;
    this.hemi.color.set(forest ? 0xc8e0c0 : 0xe2f2ff);
    this.sun.intensity = forest ? 0.6 : 0.85;
    this.sun.color.set(forest ? 0xe8f0c8 : 0xfff0d0);
    this.sun.position.set(mid + 9, 22, mid + 7);
    this.sun.target.position.set(mid, 0, mid);

    // Floating island underneath the board
    const baseTex = MAT.dirt.map!.clone();
    baseTex.needsUpdate = true;
    baseTex.wrapS = baseTex.wrapT = THREE.RepeatWrapping;
    baseTex.repeat.set(s.size, 2);
    const baseMat = new THREE.MeshLambertMaterial({ map: baseTex });
    for (const [w, h, y] of [[s.size, 1.6, -1.2], [s.size - 3, 1.4, -2.7], [s.size - 7, 1.2, -4.0], [s.size - 11, 1, -5.1]]) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, w), baseMat);
      b.position.set(mid, y, mid);
      this.world.add(b);
    }
    const side = forest ? MAT.forestSide : MAT.grassSide;
    const groundMats = [side, side, forest ? MAT.forestTop : MAT.grassTop, MAT.dirt, side, side];
    this.stacks = [];
    for (let z = 0; z < s.size; z++) {
      const row: THREE.Mesh[][] = [];
      for (let x = 0; x < s.size; x++) {
        const g = new THREE.Mesh(groundGeo, groundMats);
        g.position.set(x, -0.2, z);
        g.receiveShadow = true;
        g.userData.tile = { x, z };
        this.world.add(g);
        this.pickables.push(g);
        row.push([]);
      }
      this.stacks.push(row);
    }
    for (let z = 0; z < s.size; z++) for (let x = 0; x < s.size; x++) {
      for (const m of s.tiles[z][x].blocks) this.addBlock(x, z, m);
      if (s.tiles[z][x].fire > 0) this.setFire(x, z, true);
      if (s.tiles[z][x].tower) this.setTower(x, z, true);
      if (s.tiles[z][x].trap) this.setTrap(x, z, true);
    }
    for (const u of s.units) if (u.alive) this.addUnit(u);
    this.updateFog();
    this.fitCamera();
  }

  private blockMesh(mat: Mat): THREE.Mesh {
    if (mat === 'well') {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.7, 0.9), [MAT.stone, MAT.stone, MAT.water, MAT.stone, MAT.stone, MAT.stone]);
      const wood = new THREE.MeshLambertMaterial({ color: 0x6b4a2b });
      for (const px of [-0.38, 0.38]) {
        const p = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.8, 0.08), wood);
        p.position.set(px, 0.65, 0);
        p.castShadow = true;
        m.add(p);
      }
      const roof = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.12, 0.7), MAT.roof);
      roof.position.y = 1.08;
      roof.castShadow = true;
      m.add(roof);
      m.position.y = -0.15;
      return m;
    }
    const tex: Record<Exclude<Mat, 'well'>, THREE.Material> = {
      stone: MAT.stone, cobble: MAT.cobble, plank: MAT.plank, plank2: MAT.plank2, hay: MAT.hay, log: MAT.log,
      leaves: MAT.leaves, roof: MAT.roof, bush: MAT.bush, ice: iceMat
    };
    const m = new THREE.Mesh(blockGeo, tex[mat]);
    if (mat === 'bush') m.scale.set(0.92, 0.85, 0.92);
    return m;
  }

  private addBlock(x: number, z: number, mat: Mat): THREE.Mesh {
    const st = this.stacks[z][x];
    const m = this.blockMesh(mat);
    m.position.x = x;
    m.position.z = z;
    m.position.y += st.length + 0.5;
    if (mat === 'bush') m.position.y -= 0.075;
    m.castShadow = true;
    m.receiveShadow = true;
    m.userData.tile = { x, z };
    m.userData.mat = mat;
    this.world.add(m);
    st.push(m);
    this.pickables.push(m);
    return m;
  }

  private removeBlock(x: number, z: number, burstIt: boolean) {
    const m = this.stacks[z][x].pop();
    if (!m) return;
    this.world.remove(m);
    this.pickables = this.pickables.filter(p => p !== m);
    if (burstIt) this.burst(m.position, BLOCK_COLOR[m.userData.mat as string] || '#888', 10, 0.2, 3);
  }

  height(x: number, z: number) { return this.stacks[z]?.[x]?.length ?? 0; }
  // Ground level for a unit: up on the platform of a Watchtower
  baseY(x: number, z: number) { return this.towers.has(key(x, z)) ? TOWER_Y : 0; }

  private setTower(x: number, z: number, on: boolean) {
    const k = key(x, z);
    const old = this.towers.get(k);
    if (!on) {
      if (old) {
        this.world.remove(old);
        this.towers.delete(k);
        this.burst(new THREE.Vector3(x, 0.8, z), '#a2763f', 14, 0.14, 3);
        this.units.forEach(v => { if (v.alive && v.x === x && v.z === z) v.group.position.y = 0; });
      }
      return;
    }
    if (old) return;
    const g = new THREE.Group();
    const post = new THREE.BoxGeometry(0.12, TOWER_Y, 0.12);
    for (const [px, pz] of [[-0.38, -0.38], [0.38, -0.38], [-0.38, 0.38], [0.38, 0.38]]) {
      const m = new THREE.Mesh(post, woodMat);
      m.position.set(px, TOWER_Y / 2, pz);
      m.castShadow = true;
      g.add(m);
    }
    const deck = new THREE.Mesh(new THREE.BoxGeometry(0.96, 0.1, 0.96), woodMat);
    deck.position.y = TOWER_Y - 0.05;
    deck.castShadow = deck.receiveShadow = true;
    g.add(deck);
    const rail = new THREE.BoxGeometry(0.96, 0.08, 0.06);
    for (const dz of [-0.45, 0.45]) { const r = new THREE.Mesh(rail, woodMat); r.position.set(0, TOWER_Y + 0.3, dz); g.add(r); }
    for (const dx of [-0.45, 0.45]) { const r = new THREE.Mesh(rail, woodMat); r.rotation.y = Math.PI / 2; r.position.set(dx, TOWER_Y + 0.3, 0); g.add(r); }
    // A small crossbow on the rail
    const bow = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.06, 0.08), new THREE.MeshLambertMaterial({ color: 0x5a3d22 }));
    bow.position.set(0, TOWER_Y + 0.38, 0.45);
    g.add(bow);
    g.position.set(x, 0, z);
    g.userData.tile = { x, z };
    g.traverse(o => { o.userData.tile = { x, z }; });
    this.world.add(g);
    this.pickables.push(g);
    this.towers.set(k, g);
  }

  private setTrap(x: number, z: number, on: boolean) {
    const k = key(x, z);
    const old = this.traps.get(k);
    if (!on) { if (old) { this.world.remove(old); this.traps.delete(k); } return; }
    if (old) return;
    const g = new THREE.Group();
    const mat = new THREE.MeshLambertMaterial({ color: 0x8a8a8a });
    const ring = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.04, 0.6), new THREE.MeshLambertMaterial({ color: 0x5a3d22, transparent: true, opacity: 0.8 }));
    ring.position.y = 0.02;
    g.add(ring);
    for (let i = 0; i < 6; i++) {
      const t = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.16, 0.06), mat);
      const a = (i / 6) * Math.PI * 2;
      t.position.set(Math.cos(a) * 0.22, 0.1, Math.sin(a) * 0.22);
      g.add(t);
    }
    g.position.set(x, 0, z);
    this.world.add(g);
    this.traps.set(k, g);
  }

  private setFire(x: number, z: number, on: boolean) {
    const k = key(x, z);
    const old = this.fires.get(k);
    if (!on) {
      if (old) { this.world.remove(old.group); this.fires.delete(k); }
      return;
    }
    if (old) return;
    const group = new THREE.Group();
    const cubes: THREE.Mesh[] = [];
    for (let i = 0; i < 5; i++) {
      const c = new THREE.Mesh(fireGeo, fireMats[i % 3]);
      c.position.set((Math.random() - 0.5) * 0.6, 0.1, (Math.random() - 0.5) * 0.6);
      c.userData.phase = Math.random() * 6;
      group.add(c);
      cubes.push(c);
    }
    group.position.set(x, 0, z);
    this.world.add(group);
    this.fires.set(k, { group, x, z, cubes });
  }

  private addUnit(u: Unit): UnitView {
    const small = u.cls === 'grunt' && u.maxHp <= BALANCE.shaman.summonHp;
    const m = buildModel(u.cls, u.team, small);
    m.group.position.set(u.x, this.baseY(u.x, u.z), u.z);
    m.group.rotation.y = u.team === 'hero' ? Math.PI : 0;
    m.group.userData.unitId = u.id;
    this.world.add(m.group);
    const label = document.createElement('div');
    label.className = 'hp' + (u.team === 'gob' ? ' gob' : '');
    this.labels.appendChild(label);
    const v: UnitView = {
      id: u.id, team: u.team, cls: u.cls, name: u.name, ...m, label,
      x: u.x, z: u.z, hp: u.hp, maxHp: u.maxHp, alive: true, guard: u.guard, preview: 0, hidden: false, status: statusOf(u)
    };
    this.units.set(u.id, v);
    this.renderHearts(v);
    return v;
  }

  // `compactAbove`: show a number instead of a row of hearts when there are more than this many
  heartsHTML(v: { hp: number; maxHp: number; guard: boolean; preview: number; status?: string }, compactAbove = 5) {
    const keep = Math.max(0, v.hp - v.preview);
    let s = (v.status ? `<span class="st">${v.status}</span>` : '') + (v.guard ? '<span class="ow" title="On overwatch">👁</span>' : '');
    if (v.maxHp > compactAbove) {
      // Big health bars (like the Troll's) as a number so the label stays small
      return s + `<span class="f">♥</span>${keep}${v.preview ? `<span class="l">(-${Math.min(v.hp, v.preview)})</span>` : ''}<span class="e">/${v.maxHp}</span>`;
    }
    for (let i = 0; i < v.maxHp; i++) s += i < keep ? '<span class="f">♥</span>' : i < v.hp ? '<span class="l">♥</span>' : '<span class="e">♥</span>';
    return s;
  }
  renderHearts(v: UnitView) {
    v.label.innerHTML = this.heartsHTML(v);
    v.label.classList.toggle('inspect', this.inspected === v.id);
  }
  setPreviews(p: Map<string, number>) {
    this.units.forEach(v => { if (!v.alive) return; v.preview = p.get(v.id) ?? 0; this.renderHearts(v); });
  }

  /* ---------- Fog of war (forest) ---------- */

  private sees(x: number, z: number): boolean {
    if (this.theme !== 'forest') return true;
    for (const v of this.units.values()) {
      if (v.alive && v.team === 'hero' && Math.hypot(v.x - x, v.z - z) <= BALANCE.sight.forestHero + 0.01) return true;
    }
    return false;
  }

  updateFog() {
    let used = 0;
    if (this.theme === 'forest') {
      for (let z = 0; z < this.size; z++) for (let x = 0; x < this.size; x++) {
        if (this.sees(x, z)) continue;
        let m = this.fogPool[used];
        if (!m) {
          m = new THREE.Mesh(fogGeo, fogMat);
          m.rotation.x = -Math.PI / 2;
          m.renderOrder = 2;
          this.scene.add(m);
          this.fogPool.push(m);
        }
        m.position.set(x, this.height(x, z) + 0.03, z);
        m.visible = true;
        used++;
      }
    }
    for (let i = used; i < this.fogPool.length; i++) this.fogPool[i].visible = false;
    this.units.forEach(v => {
      if (!v.alive) return;
      v.hidden = v.team === 'gob' && !this.sees(v.x, v.z);
      v.group.visible = !v.hidden;
    });
  }

  /* ---------- Highlights ---------- */

  hl(x: number, z: number, color: string, opacity: number, y = 0) {
    let m = this.hlPool[this.hlUsed];
    if (!m) {
      m = new THREE.Mesh(hlGeo, new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false }));
      m.rotation.x = -Math.PI / 2;
      m.renderOrder = 3;
      this.scene.add(m);
      this.hlPool.push(m);
    }
    const mat = m.material as THREE.MeshBasicMaterial;
    mat.color.set(color);
    mat.opacity = opacity;
    m.position.set(x, y + 0.035, z);
    m.visible = true;
    this.hlUsed++;
  }
  private lines: THREE.Group | null = null;
  private dotGeo = new THREE.BoxGeometry(0.09, 0.09, 0.09);
  private dotMat = new THREE.MeshBasicMaterial({ color: 0xff6a4a, depthTest: false, transparent: true, opacity: 0.95 });
  // Dotted sight lines from a tile to targets: [fromX, fromZ, toX, toZ]
  setLines(list: [number, number, number, number][]) {
    if (this.lines) { this.scene.remove(this.lines); this.lines = null; }
    if (!list.length) return;
    const g = new THREE.Group();
    for (const [ax, az, bx, bz] of list) {
      const ay = this.height(ax, az) + 0.9, by = this.height(bx, bz) + 0.9;
      const n = Math.max(2, Math.round(Math.hypot(bx - ax, bz - az) * 3));
      for (let i = 1; i < n; i++) {
        const k = i / n;
        const d = new THREE.Mesh(this.dotGeo, this.dotMat);
        d.position.set(ax + (bx - ax) * k, ay + (by - ay) * k, az + (bz - az) * k);
        d.renderOrder = 4;
        g.add(d);
      }
    }
    this.lines = g;
    this.scene.add(g);
  }

  hlClear() { this.hlPool.forEach(m => { m.visible = false; }); this.hlUsed = 0; }

  /* ---------- Effects ---------- */

  tween(dur: number, fn: (k: number) => void): Promise<void> {
    if (reduceMotion) dur = Math.min(dur, 0.12);
    return new Promise(res => this.tweens.push({ t: 0, dur, fn, res }));
  }
  wait(s: number) { return this.tween(s, () => {}); }

  burst(pos: THREE.Vector3, color: string, n: number, size: number, speed: number) {
    const mat = new THREE.MeshLambertMaterial({ color });
    const geo = new THREE.BoxGeometry(size, size, size);
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(geo, mat);
      m.position.copy(pos);
      m.position.x += (Math.random() - 0.5) * 0.5;
      m.position.y += (Math.random() - 0.5) * 0.5;
      m.position.z += (Math.random() - 0.5) * 0.5;
      this.scene.add(m);
      this.particles.push({ m, v: new THREE.Vector3((Math.random() - 0.5) * speed, Math.random() * speed + 1.5, (Math.random() - 0.5) * speed), life: 0.8 + Math.random() * 0.3, age: 0 });
    }
  }

  floatText(pos: THREE.Vector3, text: string, color = '#fff') {
    const el = document.createElement('div');
    el.className = 'float';
    el.textContent = text;
    el.style.color = color;
    this.labels.appendChild(el);
    this.floats.push({ el, pos: pos.clone(), age: 0, life: 1.1 });
  }

  headPos(v: UnitView) { return new THREE.Vector3(v.group.position.x, 1.7 + v.group.position.y, v.group.position.z); }

  private face(v: UnitView, x: number, z: number) {
    if (x === v.x && z === v.z) return;
    v.group.rotation.y = Math.atan2(x - v.x, z - v.z);
  }

  private async flash(v: UnitView) {
    v.mats.forEach(m => m.emissive.setRGB(1, 1, 1));
    await this.wait(0.1);
    v.mats.forEach(m => m.emissive.copy(m.userData.e));
  }

  private async projectile(from: THREE.Vector3, to: THREE.Vector3, kind: 'arrow' | 'bolt' | 'light' | 'hex' | 'fireball' | 'frost' | 'snow' | 'leaf' | 'tnt') {
    let m: THREE.Mesh;
    if (kind === 'arrow') m = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.5), new THREE.MeshLambertMaterial({ color: 0x8a5a2c }));
    else if (kind === 'tnt') m = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.3), new THREE.MeshLambertMaterial({ color: 0xd33a2c }));
    else {
      const sz = kind === 'fireball' || kind === 'snow' ? 0.36 : 0.22;
      const color = kind === 'light' ? 0xfff3b0 : kind === 'hex' ? 0xb48cff : kind === 'frost' || kind === 'snow' ? 0x9fdcff : kind === 'leaf' ? 0x5fbf3a : 0xff8a3d;
      m = new THREE.Mesh(new THREE.BoxGeometry(sz, sz, sz), new THREE.MeshBasicMaterial({ color }));
    }
    this.scene.add(m);
    const big = kind === 'fireball' || kind === 'snow' || kind === 'tnt';
    const arc = Math.min(2.5, from.distanceTo(to) * 0.18) + (big ? 1 : 0);
    const prev = from.clone();
    await this.tween(big ? 0.5 : 0.32, k => {
      const p = from.clone().lerp(to, k);
      p.y += Math.sin(Math.PI * k) * arc;
      m.position.copy(p);
      m.lookAt(p.clone().add(p.clone().sub(prev)));
      if (kind !== 'arrow') m.rotation.x += 0.3;
      prev.copy(p);
    });
    this.scene.remove(m);
  }

  private async lunge(v: UnitView, x: number, z: number) {
    const sx = v.x, sz = v.z, y = v.group.position.y;
    const dx = (x - sx) * 0.35, dz = (z - sz) * 0.35;
    await this.tween(0.12, k => { v.group.position.set(sx + dx * k, y, sz + dz * k); });
    await this.tween(0.14, k => { v.group.position.set(sx + dx * (1 - k), y, sz + dz * (1 - k)); });
  }
  private from(v: UnitView, y = 0.9) { return new THREE.Vector3(v.x, v.group.position.y + y, v.z); }

  /* ---------- Playing events ---------- */

  async animate(events: GameEvent[], s: GameState) {
    let fireSound = false;
    for (let i = 0; i < events.length; i++) {
      const e = events[i];
      // Area abilities hit several units at once: play those together
      if (e.t === 'damage' && e.cause === 'ability') {
        const batch: GameEvent[] = [];
        while (i < events.length && (events[i].t === 'damage' || events[i].t === 'death')) batch.push(events[i++]);
        i--;
        const byUnit = new Map<string, GameEvent[]>();
        batch.forEach(b => { if ('id' in b) byUnit.set(b.id, [...(byUnit.get(b.id) || []), b]); });
        await Promise.all([...byUnit.values()].map(async list => { for (const b of list) await this.playOne(b, s); }));
        continue;
      }
      if (e.t === 'fire' && e.on && !fireSound) { fireSound = true; play('fire'); }
      await this.playOne(e, s);
    }
    this.sync(s);
  }

  private async playOne(e: GameEvent, s: GameState) {
    const sfx = (n: Sfx) => play(n);
    switch (e.t) {
      case 'step': {
        const v = this.units.get(e.id);
        if (!v) return;
        const fx = v.x, fz = v.z;
        this.face(v, e.x, e.z);
        const show = !(v.team === 'gob' && !this.sees(fx, fz) && !this.sees(e.x, e.z));
        const y0 = this.baseY(fx, fz), y1 = this.baseY(e.x, e.z);
        if (show) {
          sfx('step');
          await this.tween(0.17, k => {
            v.group.position.x = fx + (e.x - fx) * k;
            v.group.position.z = fz + (e.z - fz) * k;
            v.group.position.y = y0 + (y1 - y0) * k + Math.sin(Math.PI * k) * 0.22;
          });
        }
        v.x = e.x; v.z = e.z;
        v.group.position.set(e.x, y1, e.z);
        this.updateFog();
        return;
      }
      case 'attack': {
        const a = this.units.get(e.id), t = this.units.get(e.target);
        if (!t) return;
        if (!a) {
          // A Watchtower's crossbow
          if (!e.from) return;
          sfx('arrow');
          await this.projectile(new THREE.Vector3(e.from[0], TOWER_Y + 0.5, e.from[1]), new THREE.Vector3(t.x, 0.8, t.z), 'arrow');
          return;
        }
        if (e.overwatch) {
          a.guard = false;
          this.renderHearts(a);
          this.floatText(this.headPos(a), 'Overwatch!', '#f2c14e');
          sfx('guard');
          await this.wait(0.25);
        }
        this.face(a, t.x, t.z);
        if (CLASSES[a.cls].range === 1) { sfx('swing'); await this.lunge(a, t.x, t.z); }
        else {
          sfx(e.kind === 'arrow' ? 'arrow' : e.kind === 'hex' ? 'hex' : 'bolt');
          await this.projectile(this.from(a), this.from(t, 0.8), e.kind === 'melee' ? 'arrow' : e.kind);
        }
        return;
      }
      case 'damage': {
        const v = this.units.get(e.id);
        if (!v) return;
        v.hp = Math.max(0, v.hp - e.amount);
        if (e.cause !== 'fire') v.guard = false;
        this.renderHearts(v);
        const color = e.cause === 'graze' ? '#cfd6ea' : e.cause === 'fire' ? '#ff8a3d' : e.cause === 'ability' ? '#ffd23a' : '#ffffff';
        if (!v.hidden) this.floatText(this.headPos(v), e.label, color);
        sfx(e.cause === 'graze' ? 'graze' : e.cause === 'fire' ? 'fire' : 'hit');
        this.flash(v);
        const ox = v.group.position.x;
        await this.tween(0.18, k => { v.group.position.x = ox + Math.sin(k * Math.PI * 4) * 0.06 * (1 - k); });
        v.group.position.x = ox;
        if (v.cls === 'tnt') v.hp = 0;
        return;
      }
      case 'death': {
        const v = this.units.get(e.id);
        if (!v || !v.alive) return;
        v.alive = false;
        v.label.remove();
        sfx('death');
        const g = v.group;
        await this.tween(0.35, k => { g.rotation.x = (-Math.PI / 2) * ease(k); });
        this.burst(new THREE.Vector3(g.position.x, 0.5, g.position.z), v.cls === 'tnt' ? '#d33a2c' : v.team === 'hero' ? '#9fb7e0' : '#76b041', 12, 0.14, 3);
        await this.tween(0.3, k => { g.scale.setScalar(1 - k); });
        this.world.remove(g);
        this.updateFog();
        return;
      }
      case 'heal': {
        const v = this.units.get(e.id);
        if (!v) return;
        v.hp = Math.min(v.maxHp, v.hp + e.amount);
        this.renderHearts(v);
        if (!v.hidden) {
          this.floatText(this.headPos(v), '+' + e.amount + ' ♥', '#7cff8a');
          this.burst(new THREE.Vector3(v.x, 0.8 + v.group.position.y, v.z), e.cause === 'well' ? '#5a9ce8' : '#7cff8a', 8, 0.08, 2);
          sfx('heal');
          await this.wait(e.cause === 'well' ? 0.2 : 0.35);
        }
        return;
      }
      case 'blockRemoved': {
        const h = this.height(e.x, e.z);
        if (!h) return;
        if (e.cause === 'dig') sfx('dig');
        if (e.cause === 'smash') { sfx('smash'); this.shake = reduceMotion ? 0 : 0.2; }
        this.removeBlock(e.x, e.z, true);
        if (e.cause === 'smash' || e.cause === 'dig') await this.wait(0.08);
        return;
      }
      case 'blockAdded': {
        const m = this.addBlock(e.x, e.z, e.mat);
        sfx('build');
        const ty = m.position.y;
        await this.tween(0.2, k => { m.position.y = ty + 0.6 * (1 - k); m.scale.setScalar(0.4 + 0.6 * k); });
        m.scale.setScalar(1);
        m.position.y = ty;
        this.burst(new THREE.Vector3(e.x, this.height(e.x, e.z), e.z), '#9a9a9a', 6, 0.1, 2);
        this.updateFog();
        return;
      }
      case 'fire':
        this.setFire(e.x, e.z, e.on);
        return;
      case 'ability': {
        const v = this.units.get(e.id);
        if (!v) return;
        this.face(v, e.x, e.z);
        switch (e.key) {
          case 'spin':
            sfx('swing');
            await this.tween(0.35, () => { v.group.rotation.y += 0.32; });
            this.burst(new THREE.Vector3(v.x, 0.7, v.z), '#dfe6ee', 10, 0.1, 4);
            break;
          case 'volley':
            sfx('arrow');
            await Promise.all([0, 1, 2].map(i => this.wait(i * 0.07).then(() =>
              this.projectile(new THREE.Vector3(v.x, 0.9, v.z), new THREE.Vector3(e.x + (Math.random() - 0.5) * 1.6, 0.4, e.z + (Math.random() - 0.5) * 1.6), 'arrow'))));
            break;
          case 'fireball':
            sfx('bolt');
            await this.projectile(new THREE.Vector3(v.x, 1.1, v.z), new THREE.Vector3(e.x, 0.5, e.z), 'fireball');
            sfx('boom');
            this.burst(new THREE.Vector3(e.x, 0.8, e.z), '#ff8a3d', 22, 0.18, 6);
            this.burst(new THREE.Vector3(e.x, 0.8, e.z), '#ffd23a', 12, 0.12, 5);
            this.shake = reduceMotion ? 0 : 0.35;
            break;
          case 'build':
            await this.lunge(v, e.x, e.z);
            break;
          case 'heal':
          case 'layOnHands':
            if (e.x !== v.x || e.z !== v.z) {
              await this.projectile(this.from(v, 1.1), new THREE.Vector3(e.x, 1.0 + this.baseY(e.x, e.z), e.z), v.team === 'gob' ? 'hex' : 'light');
            }
            break;
          case 'turret':
          case 'tower':
            await this.lunge(v, e.x, e.z);
            sfx('build');
            this.burst(new THREE.Vector3(e.x, 0.5, e.z), e.key === 'tower' ? '#a2763f' : '#9a9a9a', 10, 0.12, 3);
            break;
          case 'tnt':
            sfx('swing');
            await this.projectile(this.from(v, 1.0), new THREE.Vector3(e.x, 0.3, e.z), 'tnt');
            break;
          case 'snare':
            sfx('dig');
            await this.lunge(v, e.x, e.z);
            this.burst(new THREE.Vector3(e.x, 0.2, e.z), '#6b4a2b', 8, 0.08, 2);
            break;
          case 'aimedShot':
            this.floatText(this.headPos(v), 'Aimed Shot!', '#f2c14e');
            await this.wait(0.35);
            break;
          case 'blizzard':
            sfx('bolt');
            await this.projectile(this.from(v, 1.1), new THREE.Vector3(e.x, 0.5, e.z), 'snow');
            sfx('boom');
            this.burst(new THREE.Vector3(e.x, 0.8, e.z), '#e8f6ff', 24, 0.14, 5);
            this.burst(new THREE.Vector3(e.x, 0.8, e.z), '#9fdcff', 12, 0.12, 4);
            break;
          case 'iceWall':
            sfx('bolt');
            await this.projectile(this.from(v, 1.1), new THREE.Vector3(e.x, 0.5, e.z), 'frost');
            break;
          case 'vines':
            sfx('summon');
            await this.projectile(this.from(v, 1.1), new THREE.Vector3(e.x, 0.4, e.z), 'leaf');
            this.burst(new THREE.Vector3(e.x, 0.4, e.z), '#5fbf3a', 18, 0.1, 3);
            break;
          case 'summon':
            sfx('summon');
            this.burst(new THREE.Vector3(e.x, 0.6, e.z), '#b48cff', 14, 0.12, 3);
            await this.wait(0.2);
            break;
        }
        return;
      }
      case 'summon': {
        const u = s.units.find(x => x.id === e.id);
        if (!u || this.units.has(u.id)) return;
        const v = this.addUnit(u);
        this.updateFog();
        await this.tween(0.3, k => { v.group.scale.setScalar(Math.max(0.01, k)); });
        v.group.scale.setScalar(1);
        return;
      }
      case 'momentum': {
        const v = this.units.get(e.id);
        if (!v) return;
        play('guard');
        this.floatText(new THREE.Vector3(v.group.position.x, 2.2, v.group.position.z), 'Action back!', '#7cff8a');
        await this.wait(0.3);
        return;
      }
      case 'pinned': {
        const v = this.units.get(e.id);
        if (!v || v.hidden) return;
        this.floatText(new THREE.Vector3(v.group.position.x, 2.2, v.group.position.z), 'Stopped!', '#ff8a3d');
        await this.wait(0.3);
        return;
      }
      case 'status': {
        const v = this.units.get(e.id);
        if (!v) return;
        const u = s.units.find(x => x.id === e.id);
        v.status = u ? statusOf(u) : '';
        this.renderHearts(v);
        if (v.hidden) return;
        const text = { frozen: ['Frozen!', '#9fdcff'], thaw: ['Frozen: skips a turn', '#9fdcff'], rooted: ['Rooted!', '#7cc35a'], blessed: ['Blessed!', '#fff3b0'] }[e.status];
        this.floatText(new THREE.Vector3(v.group.position.x, 2.2 + v.group.position.y, v.group.position.z), text[0], text[1]);
        if (e.status === 'frozen') this.burst(new THREE.Vector3(v.x, 0.8, v.z), '#bfe6fa', 10, 0.1, 2);
        await this.wait(0.3);
        return;
      }
      case 'explode': {
        sfx('boom');
        this.burst(new THREE.Vector3(e.x, 0.6, e.z), '#ff8a3d', 26, 0.2, 7);
        this.burst(new THREE.Vector3(e.x, 0.6, e.z), '#ffd23a', 14, 0.14, 6);
        this.burst(new THREE.Vector3(e.x, 0.6, e.z), '#4a4a4a', 12, 0.16, 5);
        this.shake = reduceMotion ? 0 : 0.45;
        this.floatText(new THREE.Vector3(e.x, 1.6, e.z), 'BOOM!', '#ff8a3d');
        await this.wait(0.3);
        return;
      }
      case 'tower':
        this.setTower(e.x, e.z, e.on);
        if (e.on) {
          sfx('build');
          const g = this.towers.get(key(e.x, e.z))!;
          await this.tween(0.25, k => { g.scale.set(1, Math.max(0.01, k), 1); });
          g.scale.set(1, 1, 1);
        } else sfx('smash');
        return;
      case 'trap':
        this.setTrap(e.x, e.z, e.on);
        if (e.sprung) {
          sfx('smash');
          this.floatText(new THREE.Vector3(e.x, 1.8, e.z), 'Snap!', '#c9a26b');
          await this.wait(0.2);
        }
        return;
      case 'guard': {
        const v = this.units.get(e.id);
        if (!v) return;
        v.guard = true;
        this.renderHearts(v);
        sfx('guard');
        this.floatText(this.headPos(v), 'Overwatch', '#f2c14e');
        return;
      }
    }
  }

  // Make the picture match the state exactly (after animations, or after loading a save)
  sync(s: GameState) {
    for (let z = 0; z < s.size; z++) for (let x = 0; x < s.size; x++) {
      const want = s.tiles[z][x].blocks;
      const st = this.stacks[z][x];
      const same = st.length === want.length && st.every((m, i) => m.userData.mat === want[i]);
      if (!same) {
        while (st.length) this.removeBlock(x, z, false);
        want.forEach(m => this.addBlock(x, z, m));
      }
      this.setFire(x, z, s.tiles[z][x].fire > 0);
      this.setTower(x, z, !!s.tiles[z][x].tower);
      this.setTrap(x, z, !!s.tiles[z][x].trap);
    }
    for (const u of s.units) {
      let v = this.units.get(u.id);
      if (u.alive && !v) v = this.addUnit(u);
      if (!v) continue;
      if (!u.alive && v.alive) { v.alive = false; v.label.remove(); this.world.remove(v.group); }
      if (!u.alive) continue;
      v.x = u.x; v.z = u.z; v.hp = u.hp; v.maxHp = u.maxHp; v.guard = u.guard; v.status = statusOf(u);
      v.group.position.set(u.x, this.baseY(u.x, u.z), u.z);
      v.group.rotation.x = 0;
      v.group.scale.setScalar(1);
      this.renderHearts(v);
    }
    this.updateFog();
  }

  /* ---------- Input and camera ---------- */

  private setupPicking() {
    const ray = new THREE.Raycaster();
    let down: { x: number; y: number; t: number; id: number } | null = null;
    this.canvas.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId }; });
    this.canvas.addEventListener('pointerup', e => {
      if (!down || down.id !== e.pointerId) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      const quick = performance.now() - down.t < 600;
      down = null;
      if (moved > 10 || !quick) return;
      const rect = this.canvas.getBoundingClientRect();
      const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
      ray.setFromCamera(ndc, this.camera);
      const targets = this.pickables.concat([...this.units.values()].filter(v => v.alive && !v.hidden).map(v => v.group));
      for (const h of ray.intersectObjects(targets, true)) {
        let o: THREE.Object3D | null = h.object;
        while (o && !o.userData.unitId && !o.userData.tile) o = o.parent;
        if (!o) continue;
        if (o.userData.unitId) { const v = this.units.get(o.userData.unitId)!; this.onTap(v.x, v.z); return; }
        this.onTap(o.userData.tile.x, o.userData.tile.z);
        return;
      }
    });
  }

  // Screen position of a tile, for pointing at things in the tutorial and tests
  screenPos(x: number, z: number, y = 0.5): { x: number; y: number } {
    this.tmp.set(x, y, z).project(this.camera);
    const r = this.canvas.getBoundingClientRect();
    return { x: r.left + ((this.tmp.x + 1) / 2) * r.width, y: r.top + ((-this.tmp.y + 1) / 2) * r.height };
  }

  fitCamera() {
    const w = this.app.clientWidth, h = this.app.clientHeight;
    const mid = (this.size - 1) / 2;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    const vfov = (this.camera.fov * Math.PI) / 180;
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * this.camera.aspect);
    const d = Math.max((this.size + 1) / 2 / Math.tan(hfov / 2), ((this.size - 1) / 2 / Math.tan(vfov / 2)) * 1.2, 11);
    const dir = new THREE.Vector3(0, 0.86, 0.51).normalize();
    this.controls.target.set(mid, 0, mid + (w < h ? 1.8 : 0.8));
    this.camera.position.copy(this.controls.target).addScaledVector(dir, d);
    this.controls.maxDistance = Math.max(34, d * 1.3);
    this.controls.update();
  }

  // Swing back to the starting camera spot
  lookHome() {
    const w = this.app.clientWidth, h = this.app.clientHeight;
    const mid = (this.size - 1) / 2;
    return this.lookAt(mid, mid + (w < h ? 1.8 : 0.8), 0.5);
  }

  // Swing the camera over to a spot (used to follow goblins in their turn)
  lookAt(x: number, z: number, minMove = 3) {
    const t = this.controls.target;
    const from = t.clone();
    const off = this.camera.position.clone().sub(t);
    const to = new THREE.Vector3(Math.max(0, Math.min(this.size - 1, x)), 0, Math.max(0, Math.min(this.size - 1, z)));
    if (from.distanceTo(to) < minMove) return Promise.resolve();
    return this.tween(0.35, k => {
      t.copy(from).lerp(to, ease(k));
      this.camera.position.copy(t).add(off);
    });
  }

  private resize() {
    const w = this.app.clientWidth, h = this.app.clientHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private frame = () => {
    requestAnimationFrame(this.frame);
    const dt = Math.min(this.clock.getDelta(), 0.05);
    for (let i = this.tweens.length - 1; i >= 0; i--) {
      const tw = this.tweens[i];
      tw.t += dt;
      const k = Math.min(1, tw.t / tw.dur);
      tw.fn(k);
      if (k >= 1) { this.tweens.splice(i, 1); tw.res(); }
    }
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.age += dt;
      p.v.y -= 9 * dt;
      p.m.position.addScaledVector(p.v, dt);
      p.m.rotation.x += dt * 5;
      p.m.rotation.y += dt * 4;
      if (p.m.position.y < 0.05) { p.m.position.y = 0.05; p.v.multiplyScalar(0.5); p.v.y = Math.abs(p.v.y) * 0.3; }
      p.m.scale.setScalar(Math.max(0.01, 1 - p.age / p.life));
      if (p.age >= p.life) { this.scene.remove(p.m); this.particles.splice(i, 1); }
    }
    const c = this.controls;
    c.update();
    // Keep the camera looking at the board, however far you drag
    const tx = Math.min(this.size, Math.max(-1, c.target.x)), tz = Math.min(this.size + 1, Math.max(-1, c.target.z));
    if (tx !== c.target.x || tz !== c.target.z) {
      this.camera.position.x += tx - c.target.x;
      this.camera.position.z += tz - c.target.z;
      c.target.x = tx;
      c.target.z = tz;
    }
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt);
      this.camera.position.x += (Math.random() - 0.5) * this.shake * 0.4;
      this.camera.position.y += (Math.random() - 0.5) * this.shake * 0.4;
    }
    const t = this.clock.elapsedTime;
    const sel = this.selected ? this.units.get(this.selected) : null;
    this.selRing.visible = !!(sel && sel.alive);
    if (sel && sel.alive) {
      this.selRing.position.set(sel.group.position.x, sel.group.position.y + 0.04, sel.group.position.z);
      this.selRing.scale.setScalar(1 + Math.sin(t * 5) * 0.06);
    }
    this.units.forEach(v => { if (v.alive) v.body.position.y = Math.abs(Math.sin(t * 2.2 + v.x * 1.3 + v.z)) * 0.03; });
    this.fires.forEach(f => {
      const h = this.height(f.x, f.z);
      f.group.position.y = h;
      f.cubes.forEach((cube, i) => {
        const ph = cube.userData.phase as number;
        const k = (t * 1.6 + ph) % 1;
        cube.position.y = 0.1 + k * 0.7;
        cube.scale.setScalar(Math.max(0.05, 1 - k) * (1 + 0.3 * Math.sin(t * 9 + i)));
      });
    });
    this.renderer.render(this.scene, this.camera);

    const w = this.app.clientWidth, h = this.app.clientHeight;
    this.units.forEach(v => {
      if (!v.alive) return;
      this.tmp.set(v.group.position.x, 1.75 + v.group.position.y, v.group.position.z).project(this.camera);
      const vis = this.tmp.z < 1 && !v.hidden;
      v.label.style.display = vis ? '' : 'none';
      v.label.style.left = ((this.tmp.x + 1) / 2) * w + 'px';
      v.label.style.top = ((-this.tmp.y + 1) / 2) * h + 'px';
    });
    for (let i = this.floats.length - 1; i >= 0; i--) {
      const f = this.floats[i];
      f.age += dt;
      this.tmp.copy(f.pos);
      this.tmp.y += f.age * 0.9;
      this.tmp.project(this.camera);
      f.el.style.left = ((this.tmp.x + 1) / 2) * w + 'px';
      f.el.style.top = ((-this.tmp.y + 1) / 2) * h + 'px';
      f.el.style.opacity = String(Math.min(1, 2.2 * (1 - f.age / f.life)));
      if (f.age >= f.life) { f.el.remove(); this.floats.splice(i, 1); }
    }
  };
}
