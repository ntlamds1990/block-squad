// The game screen: turns taps into rule actions, plays the results on the 3D view, runs the
// goblins' turn, and saves after every move.
import './style.css';
import { BALANCE, CLASSES, DEFAULT_SQUAD, HERO_CLASSES, NAME_POOL, type Difficulty, type HeroClass } from './rules/balance';
import type { GameEvent, GameState, Theme, Unit } from './rules/types';
import {
  abilityOf, abilityReady, abilityTargets, adjacent, area3, attackTargets, canAttackFrom, canSee, createGame, def,
  digTargets, endEnemyTurn, endPlayerTurn, hAt, hitInfo, key, living, moveAttackOption, moveAttackTargets, moveTiles,
  pathTo, performAbility, performAttack, performDig, performGuard, performMove, performMoveAttack, reach, reachFrom,
  tileAt, unitAt, unitById, type PathNode, type SquadMember
} from './rules/game';
import { applyAction, chooseAction, turnOrder } from './rules/ai';
import { deserialize, serialize } from './rules/save';
import { View } from './render/view';
import { isMuted, play, setMuted, unlockAudio } from './ui/audio';
import { Coach } from './ui/tutorial';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const SAVE_KEY = 'blockSquad.save';
const SQUAD_KEY = 'blockSquad.squad';
const SETUP_KEY = 'blockSquad.setup';

const view = new View($('app'), $<HTMLCanvasElement>('scene'), $('labels'));

/* ---------- UI state ---------- */

type Pending =
  | { kind: 'attack'; target: string; x: number; z: number }
  | { kind: 'moveattack'; target: string; x: number; z: number; node: PathNode }
  | { kind: 'dig'; x: number; z: number }
  | { kind: 'ability'; x: number; z: number };

let s: GameState = createGame({ seed: 1, diff: 'easy', theme: 'village', squad: DEFAULT_SQUAD });
const U = {
  sel: null as string | null,
  mode: 'move' as 'move' | 'attack' | 'ability',
  pending: null as Pending | null,
  plan: null as { path: { x: number; z: number }[]; end: { x: number; z: number } } | null,
  inspect: null as string | null,
  busy: false,
  flags: new Set<string>()
};

const coach = new Coach($('coach'), $('coachText'), $('coachOk'), $('coachSkip'), () => renderAll());
const sel = (): Unit | null => (U.sel ? unitById(s, U.sel) : null);
const myTurn = () => s.phase === 'player' && !U.busy;
const isOver = () => s.phase === 'over';

/* ---------- Saving ---------- */

function save() {
  try {
    if (s.phase === 'over') localStorage.removeItem(SAVE_KEY);
    else localStorage.setItem(SAVE_KEY, serialize(s));
  } catch { /* storage full or private mode: play on without saving */ }
}
function loadSave(): GameState | null {
  try { return deserialize(localStorage.getItem(SAVE_KEY)); } catch { return null; }
}

/* ---------- Turn flow ---------- */

function banner(text: string) {
  const b = $('banner');
  b.textContent = text;
  b.style.opacity = '1';
  clearTimeout((banner as unknown as { t: number }).t);
  (banner as unknown as { t: number }).t = window.setTimeout(() => { b.style.opacity = '0'; }, 1100);
}

async function animate(ev: GameEvent[]) {
  await view.animate(ev, s);
}

async function run(fn: () => Promise<void>) {
  U.busy = true;
  renderAll();
  try { await fn(); } finally { U.busy = false; }
}

function startPlayerTurn() {
  U.mode = 'move';
  U.pending = null;
  U.plan = null;
  U.inspect = null;
  U.sel = living(s, 'hero').find(h => h.ap > 0)?.id ?? null;
  banner('Your turn');
  play('turn');
  view.lookHome();
  save();
  renderAll();
}

async function afterHeroAction() {
  U.pending = null;
  U.plan = null;
  U.inspect = null;
  U.mode = 'move';
  save();
  if (checkEnd()) return;
  const u = sel();
  if (u && (!u.alive || u.ap <= 0)) U.sel = living(s, 'hero').find(h => h.ap > 0)?.id ?? null;
  renderAll();
  if (!living(s, 'hero').some(h => h.ap > 0)) {
    await view.wait(0.5);
    enemyTurn(false);
  }
}

async function enemyTurn(resume: boolean) {
  if (U.busy && !resume) return;
  if (!resume && s.phase !== 'player') return;
  U.busy = true;
  U.sel = null; U.pending = null; U.plan = null; U.inspect = null;
  try {
    if (!resume) {
      const ev = endPlayerTurn(s);
      renderAll();
      banner("Goblins' turn");
      play('turn');
      await view.wait(0.6);
      await animate(ev);
    } else renderAll();
    for (const g of turnOrder(s, 'gob')) {
      if (isOver()) break;
      if (!g.alive || g.ap <= 0) continue;
      if (canSee(s, 'hero', g)) await view.lookAt(g.x, g.z + 2);
      for (let i = 0; i < 6 && g.alive && g.ap > 0 && !isOver(); i++) {
        const before = g.ap;
        const ev = applyAction(s, g, chooseAction(s, g));
        await animate(ev);
        if (g.ap >= before) g.ap = 0;
      }
      g.ap = 0;
      save();
      renderPanel();
      if (!isOver()) await view.wait(0.2);
    }
    if (!isOver()) await animate(endEnemyTurn(s));
  } finally {
    U.busy = false;
  }
  if (checkEnd()) return;
  startPlayerTurn();
}

function checkEnd(): boolean {
  if (s.phase !== 'over') return false;
  save();
  U.sel = null;
  renderAll();
  const won = s.winner === 'hero';
  play(won ? 'win' : 'lose');
  coach.finishBattle();
  setTimeout(() => {
    const left = living(s, 'hero').length;
    $('endTitle').textContent = won ? 'Victory!' : 'Defeat';
    const place = s.theme === 'forest' ? 'The Dark Forest' : 'The village';
    $('endText').textContent = won
      ? `${place} is safe. Your squad won in ${s.turn} ${s.turn === 1 ? 'turn' : 'turns'} with ${left} of 4 heroes standing.`
      : `The goblins hold ${place.toLowerCase()} this time. Regroup and try again.`;
    $('end').hidden = false;
    $('againBtn').focus();
  }, 900);
  return true;
}

/* ---------- Player input ---------- */

function setSel(id: string | null) {
  U.sel = id;
  U.mode = 'move';
  U.pending = null;
  U.plan = null;
  renderAll();
}

const planSteps = () => (U.plan ? U.plan.path.length : 0);
function planReach(u: Unit): Map<string, PathNode> {
  if (!U.plan) return moveTiles(s, u);
  const r = reachFrom(s, U.plan.end.x, U.plan.end.z, def(u).move - planSteps(), u);
  r.delete(key(U.plan.end.x, U.plan.end.z));
  return r;
}

function walkPlan() {
  const u = sel(), plan = U.plan;
  if (!u || !plan || U.busy) return;
  U.plan = null;
  U.flags.add('moved');
  run(async () => { await animate(performMove(s, u, plan.path)); }).then(afterHeroAction);
}

async function confirmPending() {
  if (U.plan && !U.pending) { walkPlan(); return; }
  const p = U.pending, u = sel();
  if (!p || !u || U.busy) return;
  await run(async () => {
    if (p.kind === 'attack') {
      U.flags.add('attacked');
      await animate(performAttack(s, u, unitById(s, p.target)!));
    } else if (p.kind === 'moveattack') {
      U.flags.add('attacked'); U.flags.add('moved');
      await animate(performMoveAttack(s, u, pathTo(p.node), unitById(s, p.target)!));
    } else if (p.kind === 'dig') {
      await animate(performDig(s, u, p.x, p.z));
    } else {
      U.flags.add('ability');
      await animate(performAbility(s, u, p.x, p.z));
    }
  });
  afterHeroAction();
}

function handleTap(x: number, z: number) {
  unlockAudio();
  if (!myTurn()) return;
  const u = sel();
  const there = unitAt(s, x, z);
  const visibleThere = there && canSee(s, 'hero', there) ? there : null;
  const p = U.pending;
  U.inspect = null;
  if (p && p.x === x && p.z === z) { confirmPending(); return; }
  if (U.plan && U.mode === 'move' && U.plan.end.x === x && U.plan.end.z === z) { walkPlan(); return; }
  if (u && U.mode === 'ability' && abilityTargets(s, u).some(([ax, az]) => ax === x && az === z)) { setPendingAbility(x, z); return; }
  if (visibleThere && visibleThere === u && U.mode === 'move' && U.plan) { U.plan = null; renderAll(); return; }
  if (visibleThere && visibleThere.team === 'hero') { play('click'); setSel(visibleThere.id); return; }
  if (!u) {
    if (visibleThere) { U.inspect = visibleThere.id; renderAll(); }
    return;
  }
  if (U.mode === 'ability') { U.mode = 'move'; U.pending = null; renderAll(); return; }
  if (visibleThere && visibleThere.team === 'gob') {
    U.plan = null;
    U.inspect = visibleThere.id;
    const direct = u.ap > 0 && canAttackFrom(s, u, visibleThere, u.x, u.z);
    const opt = !direct && u.ap > 1 ? moveAttackOption(s, u, visibleThere) : null;
    if (direct) { U.mode = 'attack'; U.pending = { kind: 'attack', target: visibleThere.id, x, z }; }
    else if (opt) { U.mode = 'attack'; U.pending = { kind: 'moveattack', target: visibleThere.id, x, z, node: opt.node }; }
    else { U.mode = 'move'; U.pending = null; }
    play('click');
    renderAll();
    return;
  }
  if (u.cls === 'builder' && u.ap > 0 && !U.plan) {
    const t = digTargets(s, u).find(t => t.x === x && t.z === z);
    if (t) { U.mode = 'attack'; U.pending = { kind: 'dig', x, z }; renderAll(); return; }
  }
  if (p && p.kind === 'moveattack') {
    const n = moveTiles(s, u).get(key(x, z));
    const target = unitById(s, p.target)!;
    if (n && canAttackFrom(s, u, target, n.x, n.z)) { U.pending = { ...p, node: n }; renderAll(); return; }
  }
  if (U.mode === 'attack') { U.mode = 'move'; U.pending = null; renderAll(); return; }
  if (u.ap <= 0) return;
  // Route planning: the first tap plans a route, more taps add stops, tapping the end again walks it
  if (U.plan) {
    const ext = planReach(u).get(key(x, z));
    if (ext) { U.plan = { path: U.plan.path.concat(pathTo(ext)), end: { x, z } }; play('click'); renderAll(); return; }
  }
  const m = moveTiles(s, u).get(key(x, z));
  if (m) { U.plan = { path: pathTo(m), end: { x, z } }; play('click'); renderAll(); return; }
  if (U.plan) { U.plan = null; renderAll(); }
}
view.onTap = handleTap;

function setPendingAbility(x: number, z: number) {
  U.pending = { kind: 'ability', x, z };
  play('click');
  renderAll();
}

/* ---------- Highlights, previews and panel ---------- */

const COL = { move: '#4c9bff', attack: '#e2553f', ability: '#ff8a3d', area: '#ffd23a', dig: '#c9a26b', heal: '#7cff8a' };
const INSPECT = '#9b6bff';

function renderHighlights() {
  view.hlClear();
  view.selected = s.phase === 'player' ? U.sel : null;
  view.inspected = U.inspect;
  const g = U.inspect ? unitById(s, U.inspect) : null;
  if (g && g.alive && myTurn()) {
    reach(s, g, def(g).move * 2).forEach(n => { if (n.d > 0) view.hl(n.x, n.z, INSPECT, n.d <= def(g).move ? 0.5 : 0.2); });
  }
  const u = sel();
  if (!u || !u.alive || !myTurn()) return;
  if (U.mode === 'move' && u.ap > 0) {
    planReach(u).forEach(n => view.hl(n.x, n.z, COL.move, 0.42));
    if (U.plan) {
      U.plan.path.forEach(n => view.hl(n.x, n.z, tileAt(s, n.x, n.z)!.fire > 0 ? COL.attack : COL.area, 0.5));
      view.hl(U.plan.end.x, U.plan.end.z, COL.area, 0.9);
    }
    attackTargets(s, u).forEach(t => view.hl(t.x, t.z, COL.attack, 0.6));
    if (!U.plan) moveAttackTargets(s, u).forEach(t => view.hl(t.x, t.z, COL.attack, 0.28));
    digTargets(s, u).forEach(t => view.hl(t.x, t.z, COL.dig, 0.55, t.blocks.length));
  }
  if (U.mode === 'attack') {
    attackTargets(s, u).forEach(t => view.hl(t.x, t.z, COL.attack, 0.6));
    moveAttackTargets(s, u).forEach(t => view.hl(t.x, t.z, COL.attack, 0.28));
    digTargets(s, u).forEach(t => view.hl(t.x, t.z, COL.dig, 0.55, t.blocks.length));
    const pm = U.pending;
    if (pm && pm.kind === 'moveattack') {
      const target = unitById(s, pm.target)!;
      moveTiles(s, u).forEach(n => { if (canAttackFrom(s, u, target, n.x, n.z)) view.hl(n.x, n.z, COL.move, 0.35); });
      pathTo(pm.node).forEach(n => view.hl(n.x, n.z, COL.area, 0.45));
      view.hl(pm.node.x, pm.node.z, COL.area, 0.9);
    }
    if (pm) view.hl(pm.x, pm.z, COL.area, 0.85, pm.kind === 'dig' ? hAt(s, pm.x, pm.z) : 0);
  }
  if (U.mode === 'ability') {
    const ab = abilityOf(u)!;
    if (ab.key === 'spin') {
      living(s, 'gob').filter(g => adjacent(u.x, u.z, g.x, g.z)).forEach(g => view.hl(g.x, g.z, COL.attack, 0.7));
      view.hl(u.x, u.z, COL.ability, 0.6);
    } else if (ab.key === 'heal') {
      abilityTargets(s, u).forEach(([x, z]) => view.hl(x, z, COL.heal, 0.55));
    } else {
      abilityTargets(s, u).forEach(([x, z]) => view.hl(x, z, COL.ability, ab.key === 'build' ? 0.55 : 0.22, ab.key === 'build' ? hAt(s, x, z) : 0));
    }
    const pm = U.pending;
    if (pm) {
      if (ab.key === 'build' || ab.key === 'heal') view.hl(pm.x, pm.z, COL.area, 0.85, ab.key === 'build' ? hAt(s, pm.x, pm.z) : 0);
      else if (ab.key !== 'spin') area3(s, pm.x, pm.z).forEach(([x, z]) => view.hl(x, z, COL.area, 0.6, ab.key === 'fireball' ? hAt(s, x, z) : 0));
    }
  }
}

function previews(): Map<string, number> {
  const out = new Map<string, number>();
  const u = sel(), p = U.pending;
  if (!u || !p || s.phase !== 'player') return out;
  if (p.kind === 'attack' || p.kind === 'moveattack') out.set(p.target, def(u).dmg);
  if (p.kind === 'ability') {
    const ab = abilityOf(u)!;
    if (ab.key === 'spin') living(s, 'gob').filter(g => adjacent(u.x, u.z, g.x, g.z)).forEach(g => out.set(g.id, ab.amount!));
    if (ab.key === 'fireball' || ab.key === 'volley') {
      const cells = area3(s, p.x, p.z);
      living(s, 'gob').filter(g => canSee(s, 'hero', g) && cells.some(([x, z]) => x === g.x && z === g.z)).forEach(g => out.set(g.id, ab.amount!));
    }
  }
  return out;
}

const coverWord = (c: number) => (c === 2 ? 'Full cover' : c === 1 ? 'Half cover' : 'No cover');

function hearts(u: Unit) {
  return view.heartsHTML({ hp: u.hp, maxHp: u.maxHp, guard: u.guard, preview: 0 });
}

function renderPanel() {
  const roster = $('roster');
  roster.innerHTML = '';
  s.units.filter(u => u.team === 'hero').forEach(u => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip' + (u.id === U.sel ? ' sel' : '') + (u.alive ? '' : ' dead');
    b.disabled = !u.alive || s.phase !== 'player';
    b.innerHTML = `<b>${esc(u.name)}</b><span class="cls">${CLASSES[u.cls].label}</span><span class="hearts">${hearts(u)}</span>` +
      `<span class="ap" aria-label="${u.ap} actions left"><i class="${u.ap > 0 ? 'on' : ''}"></i><i class="${u.ap > 1 ? 'on' : ''}"></i></span>`;
    b.addEventListener('click', () => { unlockAudio(); if (myTurn() && u.alive) { play('click'); setSel(u.id); } });
    roster.appendChild(b);
  });

  const u = sel();
  const mine = myTurn();
  const atk = $<HTMLButtonElement>('btnAttack'), abl = $<HTMLButtonElement>('btnAbility'), conf = $<HTMLButtonElement>('btnConfirm'), guard = $<HTMLButtonElement>('btnGuard');
  $<HTMLButtonElement>('endTurn').disabled = !mine;
  $('turn').innerHTML = `Turn ${s.turn}<small>${s.phase === 'enemy' ? 'Goblins are moving' : s.phase === 'over' ? 'Battle over' : 'Your move'}</small>`;
  if (u && u.alive) {
    const C = def(u), ab = abilityOf(u)!;
    atk.innerHTML = `${C.weapon}<small>${C.range === 1 ? 'Melee' : 'Range ' + C.range}</small>`;
    const noTarget = ab.key === 'spin' ? 'No goblin next to them' : ab.key === 'heal' ? 'Nobody hurt' : 'No target';
    abl.innerHTML = `${ab.name}<small>${u.cd > 0 ? 'Ready in ' + u.cd : abilityTargets(s, u).length === 0 ? noTarget : ab.cd === 0 ? '1 action' : 'Ready'}</small>`;
    atk.disabled = !mine || u.ap <= 0 || (attackTargets(s, u).length === 0 && digTargets(s, u).length === 0 && moveAttackTargets(s, u).length === 0);
    guard.disabled = !mine || u.ap <= 0;
    abl.disabled = !mine || !abilityReady(s, u);
  } else {
    atk.innerHTML = 'Attack<small>&nbsp;</small>';
    abl.innerHTML = 'Ability<small>&nbsp;</small>';
    atk.disabled = abl.disabled = guard.disabled = true;
  }
  atk.classList.toggle('on', U.mode === 'attack');
  abl.classList.toggle('on', U.mode === 'ability');
  conf.disabled = !mine || (!U.pending && !U.plan);
  const p = U.pending;
  conf.textContent = !p ? (U.plan ? 'Move!' : 'Confirm') : p.kind === 'attack' ? 'Attack!' : p.kind === 'moveattack' ? 'Go!' : p.kind === 'dig' ? 'Dig!'
    : u && abilityOf(u)!.key === 'build' ? 'Build!' : u && abilityOf(u)!.key === 'heal' ? 'Heal!' : 'Cast!';
  $('hint').innerHTML = hintText();
  const m = $('muteBtn');
  m.textContent = isMuted() ? '🔇' : '🔊';
  m.setAttribute('aria-label', isMuted() ? 'Sound off' : 'Sound on');
}

function esc(t: string) {
  return t.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

function hintText(): string {
  if (s.phase === 'enemy') return 'The goblins are taking their turn…';
  if (s.phase === 'over') return 'Battle over.';
  const u = sel();
  const g = U.inspect ? unitById(s, U.inspect) : null;
  if (g && g.alive && !U.pending) {
    const C = def(g);
    const extra = g.cls === 'troll' ? ' Smashes through walls.' : g.cls === 'shaman' ? ' Heals goblins and summons more.' : '';
    return `<strong>${esc(g.name)}</strong> ${g.hp}♥ · ${C.weapon}${C.range === 1 ? ' (melee)' : ', range ' + C.range} · ${C.dmg} damage.${extra}` +
      '<br>Dark purple: where it can walk this turn. Light purple: where it can run to.' +
      (u && u.ap > 0 && !canAttackFrom(s, u, g, u.x, u.z) ? ` Out of ${esc(u.name)}'s reach right now.` : '');
  }
  if (!u) return 'Tap one of your heroes to begin.';
  const p = U.pending;
  if (p && (p.kind === 'attack' || p.kind === 'moveattack')) {
    const t = unitById(s, p.target)!;
    const i = p.kind === 'attack' ? hitInfo(s, u, t) : hitInfo(s, u, t, p.node.x, p.node.z);
    const pre = p.kind === 'moveattack' ? '<strong>Walk to the yellow tile, then attack</strong> (uses both actions). Tap another blue tile to attack from there.<br>' : '';
    const g2 = BALANCE.graze;
    const left = (n: number) => (n === 0 ? '<strong>defeated</strong>' : n + '♥ left');
    const expected = ((i.chance / 100) * i.dmg + (1 - i.chance / 100) * g2).toFixed(1);
    return `${pre}<strong>${esc(t.name)}</strong> ${t.hp}♥ · <span class="pct">${i.chance}% to hit</span> · ${coverWord(i.cover)}` +
      `<br>Hit: -${i.dmg}, ${left(Math.max(0, t.hp - i.dmg))} · Miss: -${g2}, ${left(Math.max(0, t.hp - g2))} · Expected ${expected} damage`;
  }
  if (p && p.kind === 'dig') return '<strong>Dig</strong> out the top block here. Costs 1 action. Tap again or press Dig!';
  if (p && p.kind === 'ability') {
    const ab = abilityOf(u)!;
    if (ab.key === 'build') return '<strong>Build</strong> a stone block here. Costs 1 action. Tap again or press Build!';
    if (ab.key === 'heal') {
      const f = unitAt(s, p.x, p.z)!;
      return `<strong>Heal ${esc(f.name)}</strong>: ${f.hp}♥ → ${Math.min(f.maxHp, f.hp + (ab.amount ?? 2))}♥. Tap again or press Heal!`;
    }
    if (ab.key === 'spin') return `<strong>Spin Attack</strong> hits ${living(s, 'gob').filter(g => adjacent(u.x, u.z, g.x, g.z)).length} goblin(s) for ${ab.amount}. Press Cast!`;
    const cells = area3(s, p.x, p.z);
    const hitG = living(s, 'gob').filter(g => canSee(s, 'hero', g) && cells.some(([x, z]) => x === g.x && z === g.z));
    const n = hitG.length, kills = hitG.filter(g => g.hp <= ab.amount!).length;
    const blocks = cells.reduce((a, [x, z]) => a + (tileAt(s, x, z)!.blocks.includes('well') ? 0 : hAt(s, x, z)), 0);
    return `<strong>${ab.name}</strong> here hits ${n} goblin${n === 1 ? '' : 's'}` +
      (ab.key === 'fireball' ? ` and blows up ${blocks} block${blocks === 1 ? '' : 's'}. The ground catches fire` : '') + (kills ? `, defeating ${kills}` : '') + '. Tap again or press Cast!';
  }
  if (U.plan) {
    const left = def(u).move - planSteps();
    const burns = U.plan.path.filter(n => tileAt(s, n.x, n.z)!.fire > 0).length;
    return `<strong>Route planned</strong>: ${planSteps()} of ${def(u).move} tiles. Tap the yellow end tile again (or Move!) to walk${left > 0 ? ', or tap a blue tile to add a stop.' : '.'} Tap ${esc(u.name)} to clear it.` +
      (burns ? ` <strong>Careful:</strong> this route walks through fire (-${burns}♥).` : '');
  }
  if (U.mode === 'ability') return abilityOf(u)!.desc + (abilityOf(u)!.key === 'spin' ? ' Press Cast! to spin.' : ' Tap a highlighted tile.');
  if (U.mode === 'attack') return 'Tap a goblin on a red tile to aim.' + (u.cls === 'builder' ? ' Tap a brown block to dig it out.' : '');
  if (u.ap <= 0) return `<strong>${esc(u.name)}</strong> ${u.guard ? 'is on Overwatch and will shoot the first goblin that moves into range.' : 'is done this turn.'} Pick another hero or end the turn.`;
  return `<strong>${esc(u.name)}</strong> has ${u.ap} ${u.ap === 1 ? 'action' : 'actions'}. Tap a blue tile to plan a route, or a goblin on a red tile to attack.`;
}

function renderAll() {
  view.setPreviews(previews());
  renderHighlights();
  renderPanel();
  coach.update({ s, sel: sel(), flags: U.flags });
}

/* ---------- Buttons ---------- */

$('btnAttack').addEventListener('click', () => {
  const u = sel();
  if (!myTurn() || !u) return;
  play('click');
  U.plan = null;
  U.mode = U.mode === 'attack' ? 'move' : 'attack';
  U.pending = null;
  const ts = attackTargets(s, u);
  if (U.mode === 'attack' && ts.length === 1) U.pending = { kind: 'attack', target: ts[0].id, x: ts[0].x, z: ts[0].z };
  renderAll();
});
$('btnAbility').addEventListener('click', () => {
  const u = sel();
  if (!myTurn() || !u) return;
  play('click');
  U.plan = null;
  U.mode = U.mode === 'ability' ? 'move' : 'ability';
  U.pending = null;
  const ab = abilityOf(u)!;
  if (U.mode === 'ability' && ab.key === 'spin') U.pending = { kind: 'ability', x: u.x, z: u.z };
  if (U.mode === 'ability' && ab.key === 'heal') {
    const t = abilityTargets(s, u);
    if (t.length === 1) U.pending = { kind: 'ability', x: t[0][0], z: t[0][1] };
  }
  renderAll();
});
$('btnConfirm').addEventListener('click', () => { unlockAudio(); confirmPending(); });
$('btnGuard').addEventListener('click', () => {
  const u = sel();
  if (!myTurn() || !u || u.ap <= 0) return;
  run(async () => { await animate(performGuard(s, u)); }).then(afterHeroAction);
});
$('endTurn').addEventListener('click', () => { unlockAudio(); enemyTurn(false); });
$('centerBtn').addEventListener('click', () => view.fitCamera());
$('muteBtn').addEventListener('click', () => { unlockAudio(); setMuted(!isMuted()); play('click'); renderPanel(); });
$('menuBtn').addEventListener('click', () => { if (U.busy) return; save(); showStart(); });

/* ---------- Start, setup and end screens ---------- */

interface Setup { diff: Difficulty; theme: Theme | 'random' }
function readJSON<T>(k: string, fallback: T): T {
  try { const v = localStorage.getItem(k); return v ? { ...fallback, ...JSON.parse(v) } : fallback; } catch { return fallback; }
}
const setup: Setup = readJSON<Setup>(SETUP_KEY, { diff: 'easy', theme: 'village' });
let squad: SquadMember[] = (() => {
  try {
    const v = JSON.parse(localStorage.getItem(SQUAD_KEY) || 'null');
    if (Array.isArray(v) && v.length === 4 && v.every(m => HERO_CLASSES.includes(m.cls) && typeof m.name === 'string')) return v;
  } catch { /* ignore */ }
  return DEFAULT_SQUAD.map(m => ({ ...m }));
})();

function showStart() {
  const saved = loadSave();
  $('continueBox').hidden = !saved;
  if (saved) {
    const n = living(saved, 'hero').length;
    $('saveInfo').textContent = `Turn ${saved.turn} · ${cap(saved.diff)} · ${saved.theme === 'forest' ? 'Dark Forest' : 'Village'} · ${n} of 4 heroes standing`;
  }
  $('start').hidden = false;
  $('setup').hidden = true;
  $('end').hidden = true;
  (saved ? $('continueBtn') : $('newBtn')).focus();
}
const cap = (t: string) => t[0].toUpperCase() + t.slice(1);

function renderSetup() {
  document.querySelectorAll<HTMLButtonElement>('[data-diff]').forEach(b => b.classList.toggle('on', b.dataset.diff === setup.diff));
  document.querySelectorAll<HTMLButtonElement>('[data-theme]').forEach(b => b.classList.toggle('on', b.dataset.theme === setup.theme));
  const box = $('slots');
  box.innerHTML = '';
  squad.forEach((m, i) => {
    const slot = document.createElement('div');
    slot.className = 'slot';
    const classes = HERO_CLASSES.map(c => `<button class="btn${m.cls === c ? ' on' : ''}" type="button" data-slot="${i}" data-cls="${c}" aria-pressed="${m.cls === c}">${CLASSES[c].label}</button>`).join('');
    slot.innerHTML = `<div class="classes" role="group" aria-label="Hero ${i + 1} class">${classes}</div>` +
      `<div class="nameRow"><input type="text" maxlength="14" aria-label="Hero ${i + 1} name" value="${esc(m.name)}" data-name="${i}">` +
      `<button class="btn dice" type="button" data-dice="${i}" aria-label="Random name">🎲</button></div>`;
    box.appendChild(slot);
  });
  $<HTMLInputElement>('tipsToggle').checked = coach.enabled;
}

function classInfo(c: HeroClass) {
  const C = CLASSES[c];
  $('classInfo').innerHTML = `<strong>${C.label}</strong>: ${C.blurb} ${C.hp}♥, walks ${C.move}, ${C.range === 1 ? 'melee' : 'range ' + C.range}, ${C.dmg} damage. <strong>${C.ability!.name}</strong>: ${C.ability!.desc}`;
}

function randomName(c: HeroClass, avoid: string[]) {
  const pool = NAME_POOL[c].filter(n => !avoid.includes(n));
  const list = pool.length ? pool : NAME_POOL[c];
  return list[Math.floor(Math.random() * list.length)];
}

$('slots').addEventListener('click', e => {
  const b = (e.target as HTMLElement).closest('button');
  if (!b) return;
  unlockAudio();
  play('click');
  if (b.dataset.cls) {
    const i = Number(b.dataset.slot), c = b.dataset.cls as HeroClass;
    const m = squad[i];
    // Swap to a fitting name when the old one came from the previous class's list
    const auto = NAME_POOL[m.cls].includes(m.name);
    squad[i] = { cls: c, name: auto ? randomName(c, squad.map(x => x.name)) : m.name };
    classInfo(c);
  } else if (b.dataset.dice) {
    const i = Number(b.dataset.dice);
    squad[i] = { ...squad[i], name: randomName(squad[i].cls, squad.map(x => x.name)) };
  }
  renderSetup();
});
$('slots').addEventListener('input', e => {
  const inp = e.target as HTMLInputElement;
  if (inp.dataset.name) squad[Number(inp.dataset.name)].name = inp.value;
});
document.querySelectorAll<HTMLButtonElement>('[data-diff]').forEach(b => b.addEventListener('click', () => { play('click'); setup.diff = b.dataset.diff as Difficulty; renderSetup(); }));
document.querySelectorAll<HTMLButtonElement>('[data-theme]').forEach(b => b.addEventListener('click', () => { play('click'); setup.theme = b.dataset.theme as Theme | 'random'; renderSetup(); }));

$('newBtn').addEventListener('click', () => {
  unlockAudio();
  $('start').hidden = true;
  $('setup').hidden = false;
  renderSetup();
  classInfo(squad[0].cls);
});
$('backBtn').addEventListener('click', () => showStart());
$('continueBtn').addEventListener('click', () => {
  unlockAudio();
  const saved = loadSave();
  if (!saved) { showStart(); return; }
  begin(saved);
});
$('startBtn').addEventListener('click', () => {
  unlockAudio();
  squad = squad.map(m => ({ cls: m.cls, name: m.name.trim().slice(0, 14) || randomName(m.cls, []) }));
  const tipsOn = $<HTMLInputElement>('tipsToggle').checked;
  if (tipsOn !== coach.enabled) coach.reset(tipsOn);
  try {
    localStorage.setItem(SQUAD_KEY, JSON.stringify(squad));
    localStorage.setItem(SETUP_KEY, JSON.stringify(setup));
  } catch { /* ignore */ }
  const theme: Theme = setup.theme === 'random' ? (Math.random() < 0.5 ? 'village' : 'forest') : setup.theme;
  begin(createGame({ seed: (Math.random() * 2 ** 31) >>> 0, diff: setup.diff, theme, squad }));
});
$('againBtn').addEventListener('click', () => { $('end').hidden = true; showStart(); });

function begin(state: GameState) {
  s = state;
  U.flags = new Set();
  U.busy = false;
  $('start').hidden = true;
  $('setup').hidden = true;
  $('end').hidden = true;
  view.load(s);
  save();
  if (s.phase === 'enemy') { enemyTurn(true); return; }
  if (checkEnd()) return;
  startPlayerTurn();
}

// The board behind the start screen
view.load(s);
renderPanel();
showStart();

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js').catch(() => {}); });
}

// Hooks for automated browser tests
(window as unknown as { __blockSquad: unknown }).__blockSquad = {
  state: () => s, ui: U, view, handleTap, confirmPending, endTurn: () => enemyTurn(false), coach,
  screenPos: (x: number, z: number) => view.screenPos(x, z)
};
