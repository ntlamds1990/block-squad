// The game screen: turns taps into rule actions, plays the results on the 3D view, runs the
// goblins' turn, and saves after every move.
import './style.css';
import { BALANCE, CLASSES, DEFAULT_SQUAD, HERO_CLASSES, NAME_POOL, PATHS, PATHS_OF, PROGRESS, type AbilityDef, type Difficulty, type HeroClass, type PathId, type Team } from './rules/balance';
import type { GameEvent, GameState, Theme, Unit } from './rules/types';
import {
  abilityOf, abilityReady, abilityTargets, area3, attackTargets, buildCells, canAttackFrom, canSee, cdOf, classLabel, createGame, def,
  digTargets, hAt, hitInfo, iceWallCells, key, living, moveAttackOption, moveAttackTargets, moveTiles, near8,
  pathTo, moveAttackTiles, rangeFrom, reach, reachFrom,
  tileAt, unitAt, unitById, heroMaxHp, extraGoblins, coverAt, type PathNode, type Slot, type SquadMember
} from './rules/game';
import {
  applyBattle, applyDuel, canPromote, ensureSquad, heroLabel, levelOf, newCampaign, nextLevelXp, parseCampaign, promote, recruit,
  squadMembers, toggleSquad, type BattleReport, type Campaign, type HeroRecord,
  SLOTS, buy, equip, gearList, sell, unequip
} from './rules/campaign';
import { FORGE, ICON, ITEMS, LOOT, RARITY_LABEL, fits, sellPrice, withGear, type GearSlot, type ItemId } from './rules/items';
import { chooseAction, turnOrder } from './rules/ai';
import { actAllowed, applyAct, controls, playersTurn, sideHasMoves, stateHash, teamOf, type Act } from './rules/match';
import { Link, cleanCode, newRoomCode } from './net/link';
import { deserialize, serialize } from './rules/save';
import { View } from './render/view';
import { isMusicOn, isMuted, play, setMusic, setMusicOn, setMuted, unlockAudio } from './ui/audio';
import { Coach } from './ui/tutorial';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const SAVE_KEY = 'blockSquad.save';
const SQUAD_KEY = 'blockSquad.squad';
const SETUP_KEY = 'blockSquad.setup';
const CAMPAIGN_KEY = 'blockSquad.campaign';
const MATCH_KEY = 'blockSquad.match';
const NAME_KEY = 'blockSquad.name';

const view = new View($('app'), $<HTMLCanvasElement>('scene'), $('labels'));

/* ---------- UI state ---------- */

type Pending =
  | { kind: 'attack'; target: string; x: number; z: number }
  | { kind: 'moveattack'; target: string; x: number; z: number; node: PathNode }
  | { kind: 'dig'; x: number; z: number }
  | { kind: 'ability'; x: number; z: number; slot: Slot };

let s: GameState = createGame({ seed: 1, diff: 'easy', theme: 'village', squad: DEFAULT_SQUAD });
const U = {
  sel: null as string | null,
  mode: 'move' as 'move' | 'attack' | 'ability' | 'extra',
  pending: null as Pending | null,
  plan: null as { path: { x: number; z: number }[]; end: { x: number; z: number } } | null,
  inspect: null as string | null,
  busy: false,
  waiting: 0, // the phone that joined: a move sent to the host, not back yet
  flags: new Set<string>()
};

const coach = new Coach($('coach'), $('coachText'), $('coachOk'), $('coachSkip'), () => renderAll());
const sel = (): Unit | null => (U.sel ? unitById(s, U.sel) : null);
const modeSlot = (): Slot => (U.mode === 'extra' ? 2 : 1);
const inAbilityMode = () => U.mode === 'ability' || U.mode === 'extra';

/* ---------- Whose eyes: solo, or one of two phones ---------- */

// net.seat is this phone's player number in a two-phone game (0 made the room, 1 joined)
const net = {
  link: null as Link | null,
  code: '',
  seat: undefined as number | undefined,
  nonce: 0,
  partner: '',
  tries: 0,
  left: false // the other player went back to the menu
};
const host = () => !s.match || !net.link || net.link.host;
const ME = (): Team => teamOf(s, net.seat);
const FOE = (): Team => (ME() === 'hero' ? 'gob' : 'hero');
const isMine = (u: Unit) => controls(s, net.seat, u);
const myUnits = () => s.units.filter(isMine);
const partnerName = () => (s.match && net.seat !== undefined ? s.match.names[1 - net.seat] : net.partner) || 'Your friend';
const linked = () => !s.match || !!net.link?.connected;
const myTurn = () => playersTurn(s, net.seat) && !U.busy && !U.waiting && linked();
const foeWord = (n = 1) => (s.mode === 'duel' ? (n === 1 ? 'enemy' : 'enemies') : n === 1 ? 'goblin' : 'goblins');

/* ---------- Saving ---------- */

function save() {
  try {
    if (s.match) {
      if (s.phase === 'over') localStorage.removeItem(MATCH_KEY);
      else localStorage.setItem(MATCH_KEY, JSON.stringify({ v: 1, code: net.code, seat: net.seat, state: serialize(s) }));
      return;
    }
    if (s.phase === 'over') localStorage.removeItem(SAVE_KEY);
    else localStorage.setItem(SAVE_KEY, serialize(s));
  } catch { /* storage full or private mode: play on without saving */ }
}
function loadSave(): GameState | null {
  try { return deserialize(localStorage.getItem(SAVE_KEY)); } catch { return null; }
}
interface SavedMatch { code: string; seat: number; state: GameState }
function loadMatch(): SavedMatch | null {
  try {
    const d = JSON.parse(localStorage.getItem(MATCH_KEY) || 'null');
    const st = d && deserialize(d.state);
    if (!st || !st.match || (d.seat !== 0 && d.seat !== 1) || typeof d.code !== 'string') return null;
    return { code: d.code, seat: d.seat, state: st };
  } catch { return null; }
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

// Moves are played one at a time, in order, on both phones
let chain: Promise<void> = Promise.resolve();
function enqueue(fn: () => Promise<void>): Promise<void> {
  chain = chain.then(fn).catch(e => console.error(e));
  return chain;
}

function resetUi() {
  U.mode = 'move';
  U.pending = null;
  U.plan = null;
  U.inspect = null;
}

// Every move this phone makes goes through here. Solo, or on the phone hosting a two-phone game,
// the move happens now; the phone that joined sends it to the host and waits for it to come back.
async function act(a: Act) {
  if (!actAllowed(s, a, net.seat ?? 0)) { resetUi(); renderAll(); return; }
  if (!host()) {
    if (!net.link?.connected) return;
    const n = ++net.nonce;
    U.waiting = n;
    renderAll();
    net.link.send({ t: 'act', a, n });
    setTimeout(() => { if (U.waiting === n) { U.waiting = 0; renderAll(); } }, 8000);
    return;
  }
  await commit(a);
  hostLoop();
}

// The host makes a move official: run it, tell the other phone, show it
function commit(a: Act, n?: number, from?: number): Promise<void> {
  return enqueue(async () => {
    if (s.phase === 'over') return;
    if (from !== undefined && !actAllowed(s, a, from)) { net.link?.send({ t: 'reject', n }); return; }
    const before = s.phase;
    const ev = applyAct(s, a);
    if (s.match) {
      s.match.seq++;
      net.link?.send({ t: 'act', a, seq: s.match.seq, h: stateHash(s), n });
    }
    save();
    await showAct(a, ev, before);
  });
}

// The phone that joined: a move came back from the host
function received(m: { a: Act; seq: number; h: number; n?: number }) {
  enqueue(async () => {
    if (!s.match) return;
    if (m.seq <= s.match.seq) return; // already have it
    if (m.seq !== s.match.seq + 1) { net.link?.send({ t: 'resync' }); return; }
    const before = s.phase;
    const ev = applyAct(s, m.a);
    s.match.seq = m.seq;
    if (m.n && m.n === U.waiting) U.waiting = 0;
    save();
    await showAct(m.a, ev, before);
    if (stateHash(s) !== m.h) net.link?.send({ t: 'resync' });
  });
}

// The host plays whatever needs no person: ending a finished turn, and the goblins
let looping = false, goblinNow: string | null = null;
async function hostLoop() {
  if (looping || !host()) return;
  looping = true;
  try {
    for (let i = 0; i < 500 && s.phase !== 'over'; i++) {
      const a = nextAutoAct();
      if (!a) break;
      await commit(a);
    }
  } finally { looping = false; }
}
function nextAutoAct(): Act | null {
  if (s.phase === 'over') return null;
  if (s.phase === 'player' || s.mode === 'duel') return sideHasMoves(s) ? null : { k: 'endSide' };
  let g = goblinNow ? unitById(s, goblinNow) : null;
  if (!g || !g.alive || g.ap <= 0) g = turnOrder(s, 'gob').find(u => u.ap > 0) ?? null;
  if (!g) { goblinNow = null; return { k: 'endSide' }; }
  goblinNow = g.id;
  const a = chooseAction(s, g);
  return { k: 'ai', id: g.id, a, r: s.rng.s };
}

// What the other side did since your last turn, for the line at the top
let foeLog: GameEvent[] = [];
let lastMover: string | null = null;

async function showAct(a: Act, ev: GameEvent[], before: GameState['phase']) {
  U.busy = true;
  const mover = 'id' in a ? unitById(s, a.id) : null;
  const theirs = a.k === 'endSide' || (mover && mover.team !== ME());
  if (theirs) foeLog.push(...ev);
  if (mover && isMine(mover)) { resetUi(); setTurnLog(''); }
  renderAll();
  try {
    if (a.k === 'endSide') {
      if (s.phase !== 'over' && s.phase !== before) {
        turnBanner();
        await view.wait(0.6);
      }
      await animate(ev);
    } else {
      if (mover && mover.id !== lastMover && mover.team !== ME()) {
        lastMover = mover.id;
        const v = view.units.get(mover.id);
        if (v && !v.hidden) await view.lookAt(v.x, v.z + (ME() === 'gob' ? -2 : 2));
      }
      await animate(ev);
      if (a.k === 'ai' && mover && mover.ap <= 0) await view.wait(0.2);
    }
  } finally {
    U.busy = false;
  }
  if (checkEnd()) return;
  if (a.k === 'endSide' && s.phase !== before && playersTurn(s, net.seat)) { startPlayerTurn(); return; }
  const u = sel();
  if (u && (!u.alive || u.ap <= 0 || !isMine(u))) U.sel = myUnits().find(h => h.ap > 0)?.id ?? null;
  renderAll();
}

function turnBanner() {
  if (playersTurn(s, net.seat)) return;
  banner(s.mode === 'duel' ? `${partnerName()}'s turn` : "Goblins' turn");
  play('turn');
}

function startPlayerTurn() {
  resetUi();
  lastMover = null;
  U.sel = myUnits().find(h => h.ap > 0)?.id ?? null;
  banner('Your turn');
  play('turn');
  view.lookHome();
  if (foeLog.length) setTurnLog(turnSummary(foeLog));
  foeLog = [];
  save();
  renderAll();
}

function endMyTurn() {
  if (!myTurn()) return;
  unlockAudio();
  act({ k: 'done', player: net.seat ?? 0 });
}

// A short "what happened" line after the other side moves
function turnSummary(ev: GameEvent[]): string {
  const name = (id: string) => unitById(s, id)?.name ?? '';
  const isOurs = (id: string) => { const u = unitById(s, id); return !!u && u.team === ME() && !CLASSES[u.cls].structure; };
  const hurt = new Map<string, number>();
  const fell: string[] = [], bits: string[] = [];
  let misses = 0, summons = 0, smashed = 0, frozen = 0;
  for (const e of ev) {
    if (e.t === 'damage' && isOurs(e.id)) hurt.set(e.id, (hurt.get(e.id) ?? 0) + e.amount);
    if (e.t === 'death' && isOurs(e.id)) fell.push(name(e.id));
    if (e.t === 'attack' && !e.hit && isOurs(e.target)) misses++;
    if (e.t === 'summon') summons++;
    if (e.t === 'blockRemoved' && e.cause === 'smash') smashed++;
    if (e.t === 'status' && e.status === 'thaw' && !isOurs(e.id)) frozen++;
  }
  hurt.forEach((n, id) => { if (!fell.includes(name(id))) bits.push(`${esc(name(id))} lost ${n} ${n === 1 ? 'heart' : 'hearts'}`); });
  if (fell.length) bits.push(`<strong>${fell.map(esc).join(' and ')} fell</strong>`);
  if (misses) bits.push(`${misses} ${misses === 1 ? 'attack' : 'attacks'} only grazed`);
  if (summons) bits.push(`a Shaman summoned ${summons === 1 ? 'a goblin' : summons + ' goblins'}`);
  if (smashed) bits.push(`a Troll smashed ${smashed === 1 ? 'a wall' : smashed + ' walls'}`);
  if (frozen) bits.push(`${frozen} frozen ${foeWord(frozen)} skipped the turn`);
  const who = s.mode === 'duel' ? `${esc(partnerName())}'s turn` : "Goblins' turn";
  return `<b>${who}:</b> ${bits.length ? bits.join(', ') + '.' : 'they moved, but nobody was hurt.'}`;
}
function setTurnLog(html: string) {
  const el = $('turnLog');
  el.innerHTML = html;
  el.hidden = !html;
}

function checkEnd(): boolean {
  if (s.phase !== 'over') return false;
  // Results go to the Barracks first, before the finished battle's save is cleared
  const report = s.mode === 'campaign' || s.mode === 'coop' ? applyBattle(camp, s, Math.random, net.seat) : null;
  const duelGold = s.mode === 'duel' && net.seat !== undefined ? applyDuel(camp, s, net.seat) : null;
  if (report || duelGold !== null) saveCampaign();
  save();
  U.sel = null;
  renderAll();
  const won = s.winner === ME();
  play(won ? 'win' : 'lose');
  if (!s.match) coach.finishBattle();
  if (won) view.celebrate();
  setTimeout(() => showEnd(won, report, duelGold), won ? 1500 : 900);
  return true;
}

function showEnd(won: boolean, report: BattleReport | null, duelGold: number | null) {
  const left = living(s, ME()).length;
  const total = s.units.filter(u => u.team === ME() && !CLASSES[u.cls].structure).length;
  const friend = esc(partnerName());
  $('endTitle').textContent = won ? 'Victory!' : 'Defeat';
  const place = s.theme === 'forest' ? 'The Dark Forest' : 'The village';
  const turns = `${s.turn} ${s.turn === 1 ? 'turn' : 'turns'}`;
  $('endText').innerHTML = s.mode === 'duel'
    ? (won ? `You beat ${friend} in ${turns} with ${left} of ${total} heroes standing.` : `${friend} won this time, in ${turns}. Rematch?`)
    : won
      ? `${place} is safe. ${s.mode === 'coop' ? `You and ${friend}` : 'Your squad'} won in ${turns} with ${left} of ${total} heroes standing.`
      : `The goblins hold ${place.toLowerCase()} this time. Regroup and try again.`;
  const box = $('endReport');
  box.innerHTML = '';
  if (report) {
    const lines: string[] = [`<div class="line"><span class="gold">+${report.gold} gold</span> · ${report.goblins} goblin${report.goblins === 1 ? '' : 's'} defeated</div>`];
    for (const h of report.heroes) {
      if (h.fell) { lines.push(`<div class="line fell"><b>${esc(h.name)}</b> fell in battle. They are on the Fallen Heroes wall.</div>`); continue; }
      const up = h.levelAfter > h.levelBefore;
      lines.push(`<div class="line${up ? ' up' : ''}"><b>${esc(h.name)}</b> +${h.xp} XP` +
        (h.kills ? ` (${h.kills} defeated)` : '') +
        (up ? ` · <strong>Level ${h.levelAfter}!</strong>${h.levelAfter === 2 ? ' +1 heart' : ''}` : '') +
        (h.canPromote ? ' · <strong>Ready to promote</strong> in the Barracks' : '') + '</div>');
    }
    if (report.loot) {
      const it = ITEMS[report.loot];
      lines.push(`<div class="line loot ${it.rarity}">🎁 Loot chest: ${ICON[report.loot]} <strong>${it.name}</strong> (${RARITY_LABEL[it.rarity]}). ${it.desc}` +
        (report.lootSold ? ` Your stash was full, so it was sold for ${report.lootSold} gold.` : ' It\'s in your stash.') + '</div>');
    }
    if (report.gearBack.length) lines.push(`<div class="line">Your squad carried home the fallen heroes' gear: ${report.gearBack.map(id => ICON[id] + ' ' + ITEMS[id].name).join(', ')}.</div>`);
    if (report.gearLost.length) lines.push(`<div class="line fell">Lost with the fallen: ${report.gearLost.map(id => ICON[id] + ' ' + ITEMS[id].name).join(', ')}.</div>`);
    if (report.potions.length) lines.push(`<div class="line">${report.potions.map(esc).join(', ')} drank ${report.potions.length === 1 ? 'a potion' : 'potions'} (used up).</div>`);
    if (report.freeRecruits.length) lines.push(`<div class="line">${report.freeRecruits.map(esc).join(', ')} joined the Barracks for free, so you have a full squad.</div>`);
    box.innerHTML = lines.join('');
  } else if (s.mode === 'duel') {
    box.innerHTML = `<div class="line">${duelGold ? `<span class="gold">+${duelGold} gold</span> for the winner. ` : ''}Duels are friendly: nobody is lost and no XP is earned.</div>`;
  } else if (s.mode !== 'campaign' && s.mode !== 'coop') {
    box.innerHTML = '<div class="line">Practice battle: nobody was lost and no XP was earned.</div>';
  }
  $('againBtn').textContent = s.mode === 'practice' ? 'Play again' : 'Back to camp';
  $('rematchBtn').hidden = !s.match;
  setMusic('camp');
  $('end').hidden = false;
  $('againBtn').focus();
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

// Goblins a hero could attack after walking the planned route (walls in the way block shots)
function planShots(u: Unit): { canHit: Unit[]; blocked: Unit[] } {
  const out = { canHit: [] as Unit[], blocked: [] as Unit[] };
  if (!U.plan || u.ap < 2) return out;
  const { x, z } = U.plan.end;
  for (const e of living(s, FOE())) {
    if (!canSee(s, ME(), e)) continue;
    if (canAttackFrom(s, u, e, x, z)) out.canHit.push(e);
    else if (def(u).range > 1 && Math.hypot(e.x - x, e.z - z) <= def(u).range + 0.01) out.blocked.push(e);
  }
  return out;
}

function planNode(u: Unit): PathNode {
  let n: PathNode = { x: u.x, z: u.z, d: 0, prev: null };
  for (const st of U.plan!.path) n = { x: st.x, z: st.z, d: n.d + 1, prev: n };
  return n;
}

function walkPlan() {
  const u = sel(), plan = U.plan;
  if (!u || !plan || U.busy) return;
  U.plan = null;
  U.flags.add('moved');
  act({ k: 'move', id: u.id, path: plan.path });
}

async function confirmPending() {
  if (U.plan && !U.pending) { walkPlan(); return; }
  const p = U.pending, u = sel();
  if (!p || !u || U.busy) return;
  if (p.kind === 'attack') {
    U.flags.add('attacked');
    await act({ k: 'attack', id: u.id, target: p.target });
  } else if (p.kind === 'moveattack') {
    U.flags.add('attacked'); U.flags.add('moved');
    await act({ k: 'moveattack', id: u.id, path: pathTo(p.node), target: p.target });
  } else if (p.kind === 'dig') {
    await act({ k: 'dig', id: u.id, x: p.x, z: p.z });
  } else {
    U.flags.add('ability');
    await act({ k: 'ability', id: u.id, x: p.x, z: p.z, slot: p.slot });
  }
}

function handleTap(x: number, z: number) {
  unlockAudio();
  if (!myTurn()) return;
  const u = sel();
  const there = unitAt(s, x, z);
  const visibleThere = there && canSee(s, ME(), there) ? there : null;
  const p = U.pending;
  U.inspect = null;
  if (p && p.x === x && p.z === z) { confirmPending(); return; }
  if (U.plan && U.mode === 'move' && U.plan.end.x === x && U.plan.end.z === z) { walkPlan(); return; }
  if (u && inAbilityMode() && abilityTargets(s, u, modeSlot()).some(([ax, az]) => ax === x && az === z)) { setPendingAbility(x, z); return; }
  if (visibleThere && visibleThere === u && U.mode === 'move' && U.plan) { U.plan = null; renderAll(); return; }
  if (visibleThere && isMine(visibleThere)) { play('click'); setSel(visibleThere.id); return; }
  if (!u) {
    if (visibleThere) { U.inspect = visibleThere.id; renderAll(); }
    return;
  }
  if (inAbilityMode()) { U.mode = 'move'; U.pending = null; renderAll(); return; }
  if (visibleThere && visibleThere.team === FOE() && U.plan && planShots(u).canHit.includes(visibleThere)) {
    U.mode = 'attack';
    U.inspect = visibleThere.id;
    U.pending = { kind: 'moveattack', target: visibleThere.id, x, z, node: planNode(u) };
    U.plan = null;
    play('click');
    renderAll();
    return;
  }
  if (visibleThere && visibleThere.team === FOE()) {
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
    const n = moveAttackTiles(s, u).get(key(x, z));
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
  U.pending = { kind: 'ability', x, z, slot: modeSlot() };
  play('click');
  renderAll();
}

/* ---------- Highlights, previews and panel ---------- */

const COL = { move: '#4c9bff', attack: '#e2553f', ability: '#ff8a3d', area: '#ffd23a', dig: '#c9a26b', heal: '#7cff8a' };
const INSPECT = '#9b6bff';

// Shields on tiles that give cover against the nearest goblin the squad can see
function coverShields(tiles: { x: number; z: number }[]): [number, number, number][] {
  const gobs = living(s, FOE()).filter(g => canSee(s, ME(), g));
  if (!gobs.length) return [];
  const out: [number, number, number][] = [];
  for (const t of tiles) {
    let near = gobs[0], best = Infinity;
    for (const g of gobs) { const d = Math.hypot(g.x - t.x, g.z - t.z); if (d < best) { best = d; near = g; } }
    const c = coverAt(s, t.x, t.z, near.x, near.z);
    if (c > 0) out.push([t.x, t.z, c]);
  }
  return out;
}

function renderHighlights() {
  view.hlClear();
  view.setLines([]);
  view.selected = playersTurn(s, net.seat) ? U.sel : null;
  view.inspected = U.inspect;
  const g = U.inspect ? unitById(s, U.inspect) : null;
  if (g && g.alive && myTurn()) {
    reach(s, g, def(g).move * 2).forEach(n => { if (n.d > 0) view.hl(n.x, n.z, INSPECT, n.d <= def(g).move ? 0.5 : 0.2); });
  }
  const u = sel();
  if (!u || !u.alive || !myTurn()) return;
  if (U.mode === 'move' && u.ap > 0) {
    const tilesInReach = planReach(u);
    tilesInReach.forEach(n => view.hl(n.x, n.z, COL.move, 0.42));
    view.setShields(coverShields(U.plan ? [U.plan.end] : [...tilesInReach.values(), u]));
    if (U.plan) {
      U.plan.path.forEach(n => view.hl(n.x, n.z, tileAt(s, n.x, n.z)!.fire > 0 ? COL.attack : COL.area, 0.5));
      view.hl(U.plan.end.x, U.plan.end.z, COL.area, 0.9);
      // What the hero could hit from the end of the route: red with a sight line, grey if a wall is in the way
      const shots = planShots(u);
      shots.canHit.forEach(t => view.hl(t.x, t.z, COL.attack, 0.7));
      shots.blocked.forEach(t => view.hl(t.x, t.z, '#5a6080', 0.6));
      view.setLines(shots.canHit.map(t => [U.plan!.end.x, U.plan!.end.z, t.x, t.z]));
    } else {
      attackTargets(s, u).forEach(t => view.hl(t.x, t.z, COL.attack, 0.6));
      // In range but a tall wall blocks the shot
      if (def(u).range > 1) living(s, FOE()).forEach(e => {
        if (canSee(s, ME(), e) && !canAttackFrom(s, u, e, u.x, u.z) && Math.hypot(e.x - u.x, e.z - u.z) <= def(u).range + 0.01) view.hl(e.x, e.z, '#5a6080', 0.6);
      });
    }
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
      moveAttackTiles(s, u).forEach(n => { if (canAttackFrom(s, u, target, n.x, n.z)) view.hl(n.x, n.z, COL.move, 0.35); });
      pathTo(pm.node).forEach(n => view.hl(n.x, n.z, COL.area, 0.45));
      view.hl(pm.node.x, pm.node.z, COL.area, 0.9);
    }
    if (pm) view.hl(pm.x, pm.z, COL.area, 0.85, pm.kind === 'dig' ? hAt(s, pm.x, pm.z) : 0);
  }
  if (inAbilityMode()) {
    const slot = modeSlot();
    const ab = abilityOf(u, slot)!;
    const cells = abilityTargets(s, u, slot);
    const foesNear = () => s.units.filter(g => g.alive && g.team === FOE() && canSee(s, ME(), g) && near8(u.x, u.z, g.x, g.z));
    switch (ab.key) {
      case 'spin':
        foesNear().forEach(g => view.hl(g.x, g.z, COL.attack, 0.7));
        view.hl(u.x, u.z, COL.ability, 0.6);
        break;
      case 'heal': case 'layOnHands':
        cells.forEach(([x, z]) => view.hl(x, z, COL.heal, 0.55));
        break;
      case 'aimedShot':
        cells.forEach(([x, z]) => view.hl(x, z, COL.attack, 0.6));
        break;
      case 'volley': case 'fireball': case 'blizzard': case 'vines': case 'iceWall':
        cells.forEach(([x, z]) => view.hl(x, z, COL.ability, 0.22));
        break;
      default:
        cells.forEach(([x, z]) => view.hl(x, z, COL.ability, 0.55, ab.key === 'build' ? hAt(s, x, z) : 0));
    }
    const pm = U.pending;
    if (pm && pm.kind === 'ability') {
      if (ab.key === 'build') buildCells(s, u, pm.x, pm.z).forEach(([x, z]) => view.hl(x, z, COL.area, 0.85, hAt(s, x, z)));
      else if (ab.key === 'iceWall') iceWallCells(s, u, pm.x, pm.z).forEach(([x, z]) => view.hl(x, z, COL.area, 0.8, hAt(s, x, z)));
      else if (['volley', 'fireball', 'blizzard', 'vines', 'tnt'].includes(ab.key)) area3(s, pm.x, pm.z).forEach(([x, z]) => view.hl(x, z, COL.area, ab.key === 'tnt' && (x !== pm.x || z !== pm.z) ? 0.35 : 0.6, ab.key === 'fireball' ? hAt(s, x, z) : 0));
      else if (ab.key !== 'spin') view.hl(pm.x, pm.z, COL.area, 0.85);
    }
  }
}

function previews(): Map<string, number> {
  const out = new Map<string, number>();
  const u = sel(), p = U.pending;
  if (!u || !p || !playersTurn(s, net.seat)) return out;
  if (p.kind === 'attack' || p.kind === 'moveattack') {
    const t = unitById(s, p.target)!;
    out.set(p.target, p.kind === 'attack' ? hitInfo(s, u, t).dmg : hitInfo(s, u, t, p.node.x, p.node.z, true).dmg);
  }
  if (p.kind === 'ability') {
    const ab = abilityOf(u, p.slot)!;
    if (ab.key === 'spin') living(s, FOE()).filter(g => near8(u.x, u.z, g.x, g.z)).forEach(g => out.set(g.id, ab.amount!));
    if (ab.key === 'fireball' || ab.key === 'volley' || ab.key === 'blizzard' || ab.key === 'vines') {
      const cells = area3(s, p.x, p.z);
      living(s, FOE()).filter(g => canSee(s, ME(), g) && cells.some(([x, z]) => x === g.x && z === g.z)).forEach(g => out.set(g.id, ab.amount!));
    }
    if (ab.key === 'aimedShot') {
      const t = unitAt(s, p.x, p.z);
      if (t) out.set(t.id, hitInfo(s, u, t, u.x, u.z, false, { bonus: ab.aimBonus, mult: ab.mult }).dmg);
    }
  }
  return out;
}

const coverWord = (c: number) => (c === 2 ? 'Full cover' : c === 1 ? 'Half cover' : 'No cover');

function hearts(u: Unit) {
  return view.heartsHTML({ hp: u.hp, maxHp: u.maxHp, guard: u.guard, preview: 0, status: '' }, 5);
}

function renderPanel() {
  const roster = $('roster');
  roster.innerHTML = '';
  s.units.filter(u => u.team === ME() && !CLASSES[u.cls].structure).forEach(u => {
    const b = document.createElement('button');
    b.type = 'button';
    const partners = s.mode === 'coop' && u.player !== net.seat;
    b.className = 'chip' + (u.id === U.sel ? ' sel' : '') + (u.alive ? '' : ' dead') + (partners ? ' ally' : '');
    b.disabled = !u.alive || partners || !playersTurn(s, net.seat);
    b.innerHTML = `<b>${esc(u.name)}</b><span class="cls">${classLabel(u)}${u.level && u.level > 1 ? ` <span class="lv">Lv${u.level}</span>` : ''}</span><span class="hearts">${hearts(u)}</span>` +
      `<span class="ap" aria-label="${u.ap} actions left"><i class="${u.ap > 0 ? 'on' : ''}"></i><i class="${u.ap > 1 ? 'on' : ''}"></i></span>`;
    b.addEventListener('click', () => { unlockAudio(); if (myTurn() && isMine(u)) { play('click'); setSel(u.id); } });
    roster.appendChild(b);
  });

  const u = sel();
  const mine = myTurn();
  const atk = $<HTMLButtonElement>('btnAttack'), abl = $<HTMLButtonElement>('btnAbility'), conf = $<HTMLButtonElement>('btnConfirm'), guard = $<HTMLButtonElement>('btnGuard');
  $<HTMLButtonElement>('endTurn').disabled = !mine || !myUnits().some(h => h.ap > 0);
  $('turn').innerHTML = `Turn ${s.turn}<small>${turnWord()}</small>`;
  const xb = $<HTMLButtonElement>('btnExtra');
  if (u && u.alive) {
    const C = def(u), ab = abilityOf(u)!;
    const r = rangeFrom(s, u, u.x, u.z);
    atk.innerHTML = `${C.weapon}<small>${C.range === 1 ? 'Melee' : 'Range ' + r}</small>`;
    abl.innerHTML = `${ab.short ?? ab.name}<small>${abilityStatus(u, 1)}</small>`;
    atk.disabled = !mine || u.ap <= 0 || (attackTargets(s, u).length === 0 && digTargets(s, u).length === 0 && moveAttackTargets(s, u).length === 0);
    guard.disabled = !mine || u.ap <= 0;
    const ab2 = abilityOf(u, 2);
    xb.hidden = !ab2;
    $('actions').classList.toggle('five', !!ab2);
    if (ab2) {
      xb.innerHTML = `${ab2.short ?? ab2.name}<small>${abilityStatus(u, 2)}</small>`;
      xb.disabled = !mine || !abilityReady(s, u, 2);
    }
    abl.disabled = !mine || !abilityReady(s, u);
  } else {
    atk.innerHTML = 'Attack<small>&nbsp;</small>';
    abl.innerHTML = 'Ability<small>&nbsp;</small>';
    atk.disabled = abl.disabled = guard.disabled = true;
    xb.hidden = true;
    $('actions').classList.remove('five');
  }
  xb.classList.toggle('on', U.mode === 'extra');
  atk.classList.toggle('on', U.mode === 'attack');
  abl.classList.toggle('on', U.mode === 'ability');
  conf.disabled = !mine || (!U.pending && !U.plan);
  const p = U.pending;
  conf.textContent = !p ? (U.plan ? 'Move!' : 'Confirm') : p.kind === 'attack' ? 'Attack!' : p.kind === 'moveattack' ? 'Go!' : p.kind === 'dig' ? 'Dig!'
    : u ? confirmWord(abilityOf(u, p.slot)!) : 'Confirm';
  $('hint').innerHTML = hintText();
  const m = $('muteBtn');
  m.textContent = isMuted() ? '🔇' : '🔊';
  m.setAttribute('aria-label', isMuted() ? 'Sound off' : 'Sound on');
}

function turnWord(): string {
  if (s.phase === 'over') return 'Battle over';
  if (!playersTurn(s, net.seat)) return s.mode === 'duel' ? `${esc(partnerName())} is moving` : 'Goblins are moving';
  if (s.mode === 'coop' && !myUnits().some(h => h.ap > 0)) return `${esc(partnerName())} is moving`;
  return 'Your move';
}

function abilityStatus(u: Unit, slot: Slot): string {
  const ab = abilityOf(u, slot)!;
  const cd = cdOf(u, slot);
  if (cd > 0) return 'Ready in ' + cd;
  const n = abilityTargets(s, u, slot).length;
  if (!n) {
    if (ab.max) return 'Already up';
    if (ab.key === 'spin') return ab.wide ? 'No goblin around' : 'No goblin next to them';
    if (ab.key === 'heal' || ab.key === 'layOnHands') return 'Nobody hurt';
    return 'No target';
  }
  return ab.costsOneAction ? '1 action' : 'Ready';
}

function confirmWord(ab: AbilityDef): string {
  switch (ab.key) {
    case 'build': case 'turret': case 'tower': return 'Build!';
    case 'tnt': case 'snare': return 'Place!';
    case 'heal': case 'layOnHands': return 'Heal!';
    case 'aimedShot': return 'Shoot!';
    default: return 'Cast!';
  }
}

function esc(t: string) {
  return t.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

function hintText(): string {
  if (s.phase === 'over') return 'Battle over.';
  if (s.match && !linked()) return `Waiting for ${esc(partnerName())}'s phone to link up again…`;
  if (!playersTurn(s, net.seat)) return s.mode === 'duel' ? `${esc(partnerName())} is taking their turn…` : 'The goblins are taking their turn…';
  if (U.waiting) return 'Sending your move…';
  if (s.mode === 'coop' && !myUnits().some(h => h.ap > 0)) return `Your heroes are done. Waiting for ${esc(partnerName())} to finish their turn…`;
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
    const i = p.kind === 'attack' ? hitInfo(s, u, t) : hitInfo(s, u, t, p.node.x, p.node.z, true);
    const pre = p.kind === 'moveattack' ? '<strong>Walk to the yellow tile, then attack</strong> (uses both actions). Tap another blue tile to attack from there.<br>' : '';
    const g2 = BALANCE.graze;
    const left = (n: number) => (n === 0 ? '<strong>defeated</strong>' : n + '♥ left');
    const expected = ((i.chance / 100) * i.dmg + (1 - i.chance / 100) * g2).toFixed(1);
    return `${pre}<strong>${esc(t.name)}</strong> ${t.hp}♥ · <span class="pct">${i.chance}% to hit</span> · ${coverWord(i.cover)}` +
      `<br>Hit: -${i.dmg}, ${left(Math.max(0, t.hp - i.dmg))} · Miss: -${g2}, ${left(Math.max(0, t.hp - g2))} · Expected ${expected} damage`;
  }
  if (p && p.kind === 'dig') return '<strong>Dig</strong> out the top block here. Costs 1 action. Tap it again or press Dig!';
  if (p && p.kind === 'ability') return abilityHint(u, abilityOf(u, p.slot)!, p.x, p.z) + ' <em>Tap it again or press ' + confirmWord(abilityOf(u, p.slot)!) + '</em>';
  if (U.plan) {
    const left = def(u).move - planSteps();
    const burns = U.plan.path.filter(n => tileAt(s, n.x, n.z)!.fire > 0).length;
    return `<strong>Route planned</strong>: ${planSteps()} of ${def(u).move} tiles. Tap the yellow end tile again (or Move!) to walk${left > 0 ? ', or tap a blue tile to add a stop.' : '.'} Tap ${esc(u.name)} to clear it.` +
      (burns ? ` <strong>Careful:</strong> this route walks through fire (-${burns}♥).` : '') + planShotText(u);
  }
  if (inAbilityMode()) { const ab = abilityOf(u, modeSlot())!; return ab.desc + (ab.key === 'spin' ? ' Press Cast! to spin.' : ' Tap a highlighted tile.'); }
  if (U.mode === 'attack') return `Tap ${s.mode === 'duel' ? 'an enemy' : 'a goblin'} on a red tile to aim.` + (u.cls === 'builder' ? ' Tap a brown block to dig it out.' : '');
  if (u.ap <= 0) return `<strong>${esc(u.name)}</strong> ${u.guard ? 'is on Overwatch and will shoot the first goblin that moves into range.' : 'is done this turn.'} Pick another hero or end the turn.`;
  return `<strong>${esc(u.name)}</strong> has ${u.ap} ${u.ap === 1 ? 'action' : 'actions'}. Tap a blue tile to plan a route and see who you can hit from there, or ${s.mode === 'duel' ? 'an enemy' : 'a goblin'} on a red tile to attack.` + (def(u).range > 1 ? ' Grey goblins are in range but behind a tall wall.' : '');
}

function abilityHint(u: Unit, ab: AbilityDef, x: number, z: number): string {
  const inArea = (cells: [number, number][], team: Team) =>
    s.units.filter(o => o.alive && o.team === team && !CLASSES[o.cls].structure && (team === ME() || canSee(s, ME(), o)) && cells.some(([cx, cz]) => cx === o.x && cz === o.z));
  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : w.endsWith('o') ? 'es' : 's'}`;
  switch (ab.key) {
    case 'build': {
      const n = buildCells(s, u, x, z).length;
      return `<strong>Build</strong> ${n === 1 ? 'a tall wall' : n + ' tall walls'} here. Costs 1 action.`;
    }
    case 'turret': return '<strong>Turret</strong> goes here. It shoots a goblin in range 5 at the end of each of your turns, all by itself. Costs 1 action.';
    case 'tower': return '<strong>Watchtower</strong> goes here. Its crossbow shoots by itself at the end of your turn, and a hero who climbs it gets +2 range and +15% to hit. Costs 1 action.';
    case 'snare': return '<strong>Snare</strong>: hide a trap here. The first goblin to step on it takes ' + BALANCE.snare.damage + ' damage and stops. Costs 1 action.';
    case 'tnt': {
      const cells = area3(s, x, z);
      const g = inArea(cells, FOE()).length, h = inArea(cells, ME()).length;
      return `<strong>TNT</strong> goes off after the goblins' turn: ${BALANCE.tnt.damage} damage to everyone around it. Right now that's ${plural(g, 'goblin')}` +
        (h ? ` and <strong>${plural(h, 'hero')}</strong> (move them away!)` : '') + '. Costs 1 action.';
    }
    case 'heal': case 'layOnHands': {
      const f = unitAt(s, x, z)!;
      return `<strong>${ab.name}: ${esc(f.name)}</strong> ${f.hp}♥ → ${Math.min(f.maxHp, f.hp + (ab.amount ?? 2))}♥.` +
        (ab.splash ? ` Friends next to them heal ${ab.splash}.` : '') + (ab.bless ? ' Their next attack gets +20% to hit.' : '') +
        (ab.costsOneAction ? ' Costs 1 action.' : '');
    }
    case 'aimedShot': {
      const t = unitAt(s, x, z)!;
      const i = hitInfo(s, u, t, u.x, u.z, false, { bonus: ab.aimBonus, mult: ab.mult });
      return `<strong>Aimed Shot at ${esc(t.name)}</strong> ${t.hp}♥ · <span class="pct">${i.chance}% to hit</span> · Hit: -${i.dmg}, miss: -${BALANCE.graze}.`;
    }
    case 'spin': {
      const n = living(s, FOE()).filter(g => near8(u.x, u.z, g.x, g.z)).length;
      return `<strong>${ab.name}</strong> hits ${plural(n, 'goblin')} for ${ab.amount}.`;
    }
    case 'iceWall': return `<strong>Ice Wall</strong>: ${plural(iceWallCells(s, u, x, z).length, 'tall ice block')} here, melting after ${ab.rounds ?? 3} turns.` + (ab.costsOneAction ? ' Costs 1 action.' : '');
    case 'vines': {
      const n = inArea(area3(s, x, z), FOE()).length;
      return `<strong>Vines</strong> grab ${plural(n, 'goblin')}: ${ab.amount ?? 0} damage, and they can't move next turn.` + (ab.costsOneAction ? ' Costs 1 action.' : '');
    }
  }
  const cells = area3(s, x, z);
  const hitG = inArea(cells, FOE());
  const n = hitG.length, kills = hitG.filter(g => g.hp <= ab.amount!).length;
  const blocks = cells.reduce((a, [cx, cz]) => a + (tileAt(s, cx, cz)!.blocks.includes('well') ? 0 : hAt(s, cx, cz)), 0);
  return `<strong>${ab.name}</strong> here hits ${plural(n, 'goblin')}` +
    (ab.key === 'fireball' ? ` and blows up ${plural(blocks, 'block')}. The ground catches fire` : '') +
    (ab.key === 'blizzard' && n ? ' and freezes them' : '') + (kills ? `, defeating ${kills}` : '') + '.';
}

function planShotText(u: Unit): string {
  if (!U.plan) return '';
  if (u.ap < 2) return '<br>No action left to attack after this move.';
  const { canHit, blocked } = planShots(u);
  const { x, z } = U.plan.end;
  let out = '<br>From here: ';
  if (canHit.length) {
    out += canHit.map(e => `${esc(e.name)} <span class="pct">${hitInfo(s, u, e, x, z, true).chance}%</span>`).join(', ') + '. Tap one to walk and attack.';
  } else out += def(u).range === 1 ? 'no goblin next to this tile.' : 'no clear shot at any goblin.';
  if (blocked.length) out += ` ${blocked.length} in range ${blocked.length === 1 ? 'is' : 'are'} behind a tall wall (grey).`;
  return out;
}

function renderAll() {
  view.setPreviews(previews());
  renderHighlights();
  renderPanel();
  if (!s.match) coach.update({ s, sel: sel(), flags: U.flags });
  renderNetBar();
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
  toggleAbility(u, 1);
});
function toggleAbility(u: Unit, slot: Slot) {
  const m = slot === 2 ? 'extra' : 'ability';
  U.mode = U.mode === m ? 'move' : m;
  U.pending = null;
  const ab = abilityOf(u, slot)!;
  if (U.mode === m) {
    const t = abilityTargets(s, u, slot);
    if (ab.key === 'spin') U.pending = { kind: 'ability', x: u.x, z: u.z, slot };
    else if (['heal', 'layOnHands', 'aimedShot'].includes(ab.key) && t.length === 1) U.pending = { kind: 'ability', x: t[0][0], z: t[0][1], slot };
  }
  renderAll();
}
$('btnConfirm').addEventListener('click', () => { unlockAudio(); confirmPending(); });
$('btnExtra').addEventListener('click', () => {
  const u = sel();
  if (!myTurn() || !u) return;
  play('click');
  U.plan = null;
  toggleAbility(u, 2);
});
$('btnGuard').addEventListener('click', () => {
  const u = sel();
  if (!myTurn() || !u || u.ap <= 0) return;
  act({ k: 'guard', id: u.id });
});
$('endTurn').addEventListener('click', endMyTurn);
$('centerBtn').addEventListener('click', () => view.fitCamera());
$('muteBtn').addEventListener('click', () => { unlockAudio(); setMuted(!isMuted()); play('click'); renderPanel(); });
$('menuBtn').addEventListener('click', () => {
  if (U.busy) return;
  save();
  if (s.match) leaveLink();
  showStart();
});

/* ---------- Start, Barracks, setup and end screens ---------- */

interface Setup { diff: Difficulty; theme: Theme | 'random' }
function readJSON<T>(k: string, fallback: T): T {
  try { const v = localStorage.getItem(k); return v ? { ...fallback, ...JSON.parse(v) } : fallback; } catch { return fallback; }
}
const setup: Setup = readJSON<Setup>(SETUP_KEY, { diff: 'easy', theme: 'village' });
// Practice squad: any class and path
let squad: SquadMember[] = (() => {
  try {
    const v = JSON.parse(localStorage.getItem(SQUAD_KEY) || 'null');
    if (Array.isArray(v) && v.length === 4 && v.every(m => HERO_CLASSES.includes(m.cls) && typeof m.name === 'string')) {
      return v.map(m => ({ cls: m.cls, name: m.name, path: m.path && PATHS[m.path as PathId]?.cls === m.cls ? m.path : undefined }));
    }
  } catch { /* ignore */ }
  return DEFAULT_SQUAD.map(m => ({ ...m }));
})();

// The Barracks: made on first visit from the squad built before heroes were saved
let camp: Campaign = (() => {
  try { const c = parseCampaign(localStorage.getItem(CAMPAIGN_KEY)); if (c) return c; } catch { /* ignore */ }
  return newCampaign(squad);
})();
function saveCampaign() {
  try { localStorage.setItem(CAMPAIGN_KEY, JSON.stringify(camp)); } catch { /* ignore */ }
}
let setupMode: 'campaign' | 'practice' = 'campaign';

const overlays = ['start', 'camp', 'barracks', 'recruit', 'promote', 'fallen', 'gear', 'forge', 'setup', 'together', 'lobby', 'end'];
function showOnly(id: string | null) {
  for (const o of overlays) $(o).hidden = o !== id;
  setMusic(id === null ? 'battle' : 'camp');
  // The battle controls hide while you're in camp or the menus
  $('app').classList.toggle('offField', id !== null);
}
function renderMusicBtn() {
  const b = $('musicBtn');
  b.textContent = `🎵 Music: ${isMusicOn() ? 'on' : 'off'}`;
  b.setAttribute('aria-pressed', String(isMusicOn()));
}
renderMusicBtn();
$('musicBtn').addEventListener('click', () => { unlockAudio(); setMusicOn(!isMusicOn()); play('click'); renderMusicBtn(); });

function showStart() {
  const saved = loadSave();
  $('continueBox').hidden = !saved;
  if (saved) {
    const n = living(saved, 'hero').length;
    const total = saved.units.filter(u => u.team === 'hero' && !CLASSES[u.cls].structure).length;
    $('saveInfo').textContent = `${saved.mode === 'campaign' ? 'Camp battle' : 'Practice'} · Turn ${saved.turn} · ${cap(saved.diff)} · ${saved.theme === 'forest' ? 'Dark Forest' : 'Village'} · ${n} of ${total} heroes standing`;
  }
  const m = loadMatch();
  $('continueTogetherBox').hidden = !m;
  if (m) {
    const other = m.state.match!.names[1 - m.seat];
    $('matchInfo').textContent = `${m.state.mode === 'duel' ? 'Duel' : 'Co-op'} with ${other} · Turn ${m.state.turn} · ${m.state.theme === 'forest' ? 'Dark Forest' : 'Village'}`;
  }
  if (!view.inCamp) campScene();
  showOnly('start');
  (saved ? $('continueBtn') : m ? $('continueTogetherBtn') : $('newBtn')).focus();
}
const cap = (t: string) => t[0].toUpperCase() + t.slice(1);
const heroHp = (h: HeroRecord) => heroMaxHp(h.cls, h.path, levelOf(h.xp), gearList(h));

/* Camp: the home screen between battles */

function campScene() {
  const order = [...camp.squad, ...camp.heroes.map(h => h.id).filter(id => !camp.squad.includes(id))];
  view.loadCamp(order.map(id => camp.heroes.find(h => h.id === id)!).filter(Boolean).map(h => ({ cls: h.cls, gear: gearList(h) })));
}
function showCamp(note = '') {
  const added = ensureSquad(camp);
  saveCampaign();
  campScene();
  $('campGold').textContent = String(camp.gold);
  $('campRecord').innerHTML = note || (added.length ? `${added.map(esc).join(', ')} joined for free.` : camp.battles ? `${camp.wins} ${camp.wins === 1 ? 'win' : 'wins'} in ${camp.battles} ${camp.battles === 1 ? 'battle' : 'battles'}` : 'Tap a building, or pick your squad in the Barracks.');
  $('campForge').innerHTML = `⚒️ Forge<small>${camp.stash.length ? camp.stash.length + ' in stash' : 'Gear'}</small>`;
  $('campTemple').innerHTML = `🕯️ Temple<small>${camp.fallen.length ? camp.fallen.length + ' fallen' : 'Fallen'}</small>`;
  showOnly('camp');
}
view.onBuilding = name => {
  if ($('camp').hidden) return;
  unlockAudio();
  play('click');
  if (name === 'barracks') showBarracks();
  else if (name === 'forge') showForge();
  else if (name === 'temple') showFallen();
};
$('campBarracks').addEventListener('click', () => { play('click'); showBarracks(); });
$('campForge').addEventListener('click', () => { play('click'); showForge(); });
$('campTemple').addEventListener('click', () => { play('click'); showFallen(); });
$('campBack').addEventListener('click', () => { play('click'); showStart(); });
$('campBattle').addEventListener('click', () => {
  play('click');
  if (camp.squad.length !== Math.min(PROGRESS.squadSize, camp.heroes.length)) { showBarracks(); return; }
  showSetup('campaign');
});

/* Barracks */

let focusHero: string | null = null;
function showBarracks() {
  const added = ensureSquad(camp);
  saveCampaign();
  renderBarracks(added.length ? `${added.map(esc).join(', ')} joined for free, so you have a full squad.` : '');
  showOnly('barracks');
}

function renderBarracks(note = '') {
  $('gold').textContent = String(camp.gold);
  $('record').textContent = camp.battles ? `${camp.wins} ${camp.wins === 1 ? 'win' : 'wins'} in ${camp.battles} ${camp.battles === 1 ? 'battle' : 'battles'}` : 'No battles yet';
  $('pickLbl').textContent = `Pick ${PROGRESS.squadSize} heroes for the next battle (${camp.squad.length} of ${PROGRESS.squadSize})`;
  const list = $('heroList');
  list.innerHTML = '';
  for (const h of camp.heroes) {
    const lvl = levelOf(h.xp), need = nextLevelXp(h.xp), prev = PROGRESS.levelXp[lvl - 1];
    const pct = need === null ? 100 : Math.round(((h.xp - prev) / (need - prev)) * 100);
    const idx = camp.squad.indexOf(h.id);
    const card = document.createElement('div');
    card.className = 'heroCard' + (idx >= 0 ? ' picked' : '');
    card.setAttribute('role', 'button');
    card.tabIndex = 0;
    card.setAttribute('aria-pressed', String(idx >= 0));
    card.dataset.hero = h.id;
    card.innerHTML = `<b>${esc(h.name)}</b><span class="cls">Level ${lvl} ${heroLabel(h)}</span>` +
      `<span class="stats"><span class="f">♥</span>${heroHp(h)} · ${h.xp} XP${need === null ? '' : ' / ' + need} · ${h.kills} defeated</span>` +
      `<div class="xp" aria-hidden="true"><i style="width:${pct}%"></i></div>` +
      `<span class="gearRow" aria-label="Gear">${gearList(h).map(id => `<span title="${ITEMS[id].name}">${ICON[id]}</span>`).join('')}</span>` +
      `<span class="btns"><button class="gearBtn" type="button" data-gear="${h.id}">🎒 Gear</button>` +
      (canPromote(h) ? `<button class="promo" type="button" data-promote="${h.id}">⭐ Promote</button>` : '') + '</span>' +
      (idx >= 0 ? `<span class="num">${idx + 1}</span>` : '');
    list.appendChild(card);
  }
  const fh = focusHero ? camp.heroes.find(h => h.id === focusHero) : null;
  $('heroInfo').innerHTML = note || (fh ? heroText(fh) : 'Tap a hero to add them to the squad or take them out. Heroes level up with XP and can be promoted at level 3.');
  const rb = $<HTMLButtonElement>('recruitBtn');
  rb.innerHTML = `Recruit<small>${camp.heroes.length >= PROGRESS.maxRoster ? 'Barracks full' : PROGRESS.recruitCost + ' gold'}</small>`;
  rb.disabled = camp.heroes.length >= PROGRESS.maxRoster || camp.gold < PROGRESS.recruitCost;
  const fb = $<HTMLButtonElement>('fallenBtn');
  fb.innerHTML = `Fallen<small>${camp.fallen.length || 'None yet'}</small>`;
  $('forgeBtn').innerHTML = `Forge<small>${camp.stash.length ? camp.stash.length + ' in stash' : 'Buy gear'}</small>`;

  $<HTMLButtonElement>('toBattleBtn').disabled = camp.squad.length !== Math.min(PROGRESS.squadSize, camp.heroes.length);
}

function heroText(h: HeroRecord): string {
  const C = h.path ? { ...CLASSES[h.cls], ...PATHS[h.path].mod } : CLASSES[h.cls];
  const blurb = h.path ? PATHS[h.path].blurb : CLASSES[h.cls].blurb;
  const extra = C.extra ? ` <strong>${C.extra.name}</strong>: ${C.extra.desc}` : '';
  return `<strong>${esc(h.name)}</strong>, ${heroLabel(h)}: ${blurb} <strong>${C.ability!.name}</strong>: ${C.ability!.desc}${extra}`;
}

$('heroList').addEventListener('click', e => {
  const el = e.target as HTMLElement;
  unlockAudio();
  const pr = el.closest<HTMLElement>('[data-promote]');
  if (pr) { play('click'); showPromote(pr.dataset.promote!); return; }
  const gb = el.closest<HTMLElement>('[data-gear]');
  if (gb) { play('click'); showGear(gb.dataset.gear!); return; }
  const card = el.closest<HTMLElement>('[data-hero]');
  if (!card) return;
  play('click');
  focusHero = card.dataset.hero!;
  toggleSquad(camp, focusHero);
  saveCampaign();
  renderBarracks();
});
$('heroList').addEventListener('keydown', e => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const card = (e.target as HTMLElement).closest<HTMLElement>('[data-hero]');
  if (card && e.target === card) { e.preventDefault(); card.click(); }
});
$('barracksBack').addEventListener('click', () => { play('click'); showCamp(); });
$('toBattleBtn').addEventListener('click', () => { play('click'); showSetup('campaign'); });

/* Gear and the Forge */

const SLOT_LABEL: Record<GearSlot, string> = { weapon: 'Weapon', armour: 'Armour', charm: 'Charm' };
function itemHTML(id: ItemId, button = '', note = ''): string {
  const it = ITEMS[id];
  const forWho = it.cls ? ` For ${CLASSES[it.cls].label}s.` : '';
  return `<div class="item ${it.rarity}"><span class="ic" aria-hidden="true">${ICON[id]}</span>` +
    `<span class="tx"><span class="nm">${it.name}<small>${RARITY_LABEL[it.rarity]}</small></span><span class="ds">${it.desc}${forWho}${note}</span></span>${button}</div>`;
}

let gearHero: string | null = null;
function showGear(heroId: string, note = '') {
  gearHero = heroId;
  renderGear(note);
  showOnly('gear');
}
function renderGear(note = '') {
  const h = camp.heroes.find(x => x.id === gearHero);
  if (!h) { showBarracks(); return; }
  $('gearTitle').textContent = `${h.name}'s gear`;
  const base = h.path ? { ...CLASSES[h.cls], ...PATHS[h.path].mod } : CLASSES[h.cls];
  const C = withGear(base, gearList(h));
  $('gearStats').innerHTML = `Level ${levelOf(h.xp)} ${heroLabel(h)} · <span style="color:var(--heart)">♥</span>${heroHp(h)} · ${C.dmg} damage · ${C.aim}% aim · move ${C.move}` + (C.range > 1 ? ` · range ${C.range}` : '');
  $('gearSlots').innerHTML = SLOTS.map(sl => {
    const id = h.gear?.[sl];
    return id
      ? itemHTML(id, `<button class="btn" type="button" data-off="${sl}">Take off</button>`)
      : `<div class="item empty"><span class="ic" aria-hidden="true">·</span><span class="tx"><span class="nm">${SLOT_LABEL[sl]}</span><span class="ds">Empty. Equip something from your stash below.</span></span></div>`;
  }).join('');
  const fitting = camp.stash.map((id, i) => ({ id, i })).filter(x => fits(x.id, h.cls));
  $('gearStashLbl').textContent = fitting.length ? `From your stash (${fitting.length} ${fitting.length === 1 ? 'item fits' : 'items fit'})` : 'Your stash has nothing that fits. Buy gear at the Forge or win battles for loot chests.';
  $('gearStash').innerHTML = fitting.map(({ id, i }) => {
    const swap = h.gear?.[ITEMS[id].slot];
    return itemHTML(id, `<button class="btn primary" type="button" data-on="${i}">Equip</button>`, swap ? ` Swaps out the ${ITEMS[swap].name}.` : '');
  }).join('');
  $('gearNote').innerHTML = note;
}
$('gearSlots').addEventListener('click', e => {
  const b = (e.target as HTMLElement).closest<HTMLElement>('[data-off]');
  if (!b || !gearHero) return;
  play('click');
  unequip(camp, gearHero, b.dataset.off as GearSlot);
  saveCampaign();
  renderGear();
});
$('gearStash').addEventListener('click', e => {
  const b = (e.target as HTMLElement).closest<HTMLElement>('[data-on]');
  if (!b || !gearHero) return;
  const err = equip(camp, gearHero, Number(b.dataset.on));
  if (err) { renderGear(err); return; }
  play('build');
  saveCampaign();
  renderGear();
});
$('gearBack').addEventListener('click', () => { play('click'); renderBarracks(); showOnly('barracks'); });

function showForge(note = '') {
  renderForge(note);
  showOnly('forge');
}
function renderForge(note = '') {
  $('forgeGold').textContent = String(camp.gold);
  const full = camp.stash.length >= LOOT.stashMax;
  $('forgeItems').innerHTML = FORGE.map(id => itemHTML(id,
    `<button class="btn primary" type="button" data-buy="${id}" ${camp.gold < ITEMS[id].price || full ? 'disabled' : ''}>🪙 ${ITEMS[id].price}</button>`)).join('');
  $('stashLbl').textContent = camp.stash.length ? `Your stash (${camp.stash.length} of ${LOOT.stashMax})` : 'Your stash is empty';
  const worn = camp.heroes.flatMap(h => gearList(h).map(id => `${ICON[id]} ${ITEMS[id].name} (${h.name})`));
  $('stashItems').innerHTML = camp.stash.map((id, i) => itemHTML(id, `<button class="btn" type="button" data-sell="${i}">Sell<small>🪙 ${sellPrice(id)}</small></button>`)).join('') +
    (worn.length ? `<p class="muted">Being worn: ${worn.map(esc).join(', ')}. Take gear off on a hero's Gear screen to sell it.</p>` : '');
  $('forgeNote').innerHTML = note || (full ? `Your stash is full. Sell something to make room.` : 'Buy here, then equip from a hero\'s 🎒 Gear button in the Barracks.');
}
$('forgeBtn').addEventListener('click', () => { play('click'); showForge(); });
$('forgeItems').addEventListener('click', e => {
  const b = (e.target as HTMLElement).closest<HTMLElement>('[data-buy]');
  if (!b) return;
  const id = b.dataset.buy as ItemId;
  const err = buy(camp, id);
  if (err) { renderForge(err); return; }
  play('build');
  saveCampaign();
  renderForge(`Bought the <strong>${ITEMS[id].name}</strong>. It's in your stash.`);
});
$('stashItems').addEventListener('click', e => {
  const b = (e.target as HTMLElement).closest<HTMLElement>('[data-sell]');
  if (!b) return;
  const id = camp.stash[Number(b.dataset.sell)];
  const g = sell(camp, Number(b.dataset.sell));
  play('click');
  saveCampaign();
  renderForge(id ? `Sold the ${ITEMS[id].name} for ${g} gold.` : '');
});
$('forgeBack').addEventListener('click', () => { play('click'); showCamp(); });

/* Recruit */

let recruitCls: HeroClass = 'knight';
function showRecruit() {
  const have = new Set(camp.heroes.map(h => h.cls));
  recruitCls = HERO_CLASSES.find(c => !have.has(c)) ?? 'knight';
  $<HTMLInputElement>('recruitName').value = randomName(recruitCls, camp.heroes.map(h => h.name));
  $('recruitText').textContent = `A new hero joins at level 1 for ${PROGRESS.recruitCost} gold. You have ${camp.gold}.`;
  renderRecruit();
  showOnly('recruit');
}
function renderRecruit() {
  $('recruitClasses').innerHTML = HERO_CLASSES.map(c => `<button class="btn${c === recruitCls ? ' on' : ''}" type="button" data-cls="${c}" aria-pressed="${c === recruitCls}">${CLASSES[c].label}</button>`).join('');
  const C = CLASSES[recruitCls];
  $('recruitInfo').innerHTML = `<strong>${C.label}</strong>: ${C.blurb} ${C.hp}♥. Promotes at level 3 to ${PATHS[PATHS_OF[recruitCls][0]].label} or ${PATHS[PATHS_OF[recruitCls][1]].label}.`;
}
$('recruitBtn').addEventListener('click', () => { play('click'); showRecruit(); });
$('recruitClasses').addEventListener('click', e => {
  const b = (e.target as HTMLElement).closest<HTMLElement>('[data-cls]');
  if (!b) return;
  play('click');
  const inp = $<HTMLInputElement>('recruitName');
  const auto = NAME_POOL[recruitCls].some(n => inp.value.startsWith(n));
  recruitCls = b.dataset.cls as HeroClass;
  if (auto || !inp.value.trim()) inp.value = randomName(recruitCls, camp.heroes.map(h => h.name));
  renderRecruit();
});
$('recruitDice').addEventListener('click', () => { play('click'); $<HTMLInputElement>('recruitName').value = randomName(recruitCls, camp.heroes.map(h => h.name)); });
$('recruitCancel').addEventListener('click', () => showBarracks());
$('recruitOk').addEventListener('click', () => {
  const r = recruit(camp, recruitCls, $<HTMLInputElement>('recruitName').value);
  if (typeof r === 'string') { $('recruitText').textContent = r; return; }
  play('build');
  focusHero = r.id;
  saveCampaign();
  renderBarracks(`<strong>${esc(r.name)}</strong> the ${CLASSES[r.cls].label} joined the Barracks!`);
  showOnly('barracks');
});

/* Promote */

let promoting: { hero: string; path: PathId | null } | null = null;
function showPromote(heroId: string) {
  const h = camp.heroes.find(x => x.id === heroId);
  if (!h) return;
  promoting = { hero: heroId, path: null };
  $('promoteTitle').textContent = `Promote ${h.name}`;
  renderPromote();
  showOnly('promote');
}
function renderPromote() {
  if (!promoting) return;
  const h = camp.heroes.find(x => x.id === promoting!.hero)!;
  $('pathChoices').innerHTML = PATHS_OF[h.cls].map(p => {
    const P = PATHS[p];
    const C = { ...CLASSES[h.cls], ...P.mod };
    const extra = C.extra ? `<br><strong>${C.extra.name}</strong>: ${C.extra.desc}` : '';
    return `<button class="pathCard${promoting!.path === p ? ' on' : ''}" type="button" data-path="${p}" aria-pressed="${promoting!.path === p}">` +
      `<b>${P.label}</b><span class="job">${P.job}</span><span class="what">${P.blurb}<br><strong>${C.ability!.name}</strong>: ${C.ability!.desc}${extra}</span></button>`;
  }).join('');
  $<HTMLButtonElement>('promoteOk').disabled = !promoting.path;
  $('promoteOk').textContent = promoting.path ? `Become a ${PATHS[promoting.path].label}` : 'Promote';
}
$('pathChoices').addEventListener('click', e => {
  const b = (e.target as HTMLElement).closest<HTMLElement>('[data-path]');
  if (!b || !promoting) return;
  play('click');
  promoting.path = b.dataset.path as PathId;
  renderPromote();
});
$('promoteCancel').addEventListener('click', () => { promoting = null; showBarracks(); });
$('promoteOk').addEventListener('click', () => {
  if (!promoting?.path) return;
  const h = camp.heroes.find(x => x.id === promoting!.hero)!;
  if (promote(camp, h.id, promoting.path)) {
    play('win');
    saveCampaign();
    focusHero = h.id;
    renderBarracks(`<strong>${esc(h.name)}</strong> is now a <strong>${PATHS[promoting.path].label}</strong>! ` + heroText(h));
  }
  promoting = null;
  showOnly('barracks');
});

/* Fallen heroes */

$('fallenBtn').addEventListener('click', () => { play('click'); showFallen(); });
function showFallen() {
  $('fallenList').innerHTML = camp.fallen.slice().reverse().map(f =>
    `<div class="stone"><b>${esc(f.name)}</b>, level ${f.level} ${heroLabel(f)}<br>Fell in ${f.place} in battle ${f.battle}, after ${f.battles} ${f.battles === 1 ? 'battle' : 'battles'} and ${f.kills} goblins defeated.</div>`).join('');
  if (!camp.fallen.length) $('fallenList').innerHTML = '<div class="stone">No heroes have fallen yet. Keep it that way!</div>';
  showOnly('fallen');
}
$('fallenBack').addEventListener('click', () => { play('click'); showCamp(); });

/* Battle setup (difficulty and map for both; the hero picker for practice only) */

function showSetup(mode: 'campaign' | 'practice') {
  setupMode = mode;
  $('setupTitle').textContent = mode === 'campaign' ? 'Next battle' : 'Practice battle';
  $('setupNote').textContent = mode === 'campaign'
    ? 'Heroes who fall in this battle are gone for good. Survivors earn XP, and you earn gold either way.'
    : 'Try any class and promotion. Nothing is lost and no XP is earned.';
  $('slotBox').hidden = mode !== 'practice';
  $('squadBox').hidden = mode !== 'campaign';
  if (mode === 'campaign') {
    $('squadSummary').innerHTML = squadMembers(camp).map(m => `<div><b>${esc(m.name)}</b><small>Level ${m.level} ${heroLabel(m)}</small></div>`).join('');
  }
  $('backBtn').textContent = mode === 'campaign' ? 'Camp' : 'Back';
  renderSetup();
  if (mode === 'practice') classInfo(squad[0]);
  showOnly('setup');
}

const practiceSquad = () => squad.map(m => ({ ...m, level: m.path ? 3 : 1 }));
const DIFF_NOTE: Record<Difficulty, string> = { easy: '', normal: ', with a Troll', hard: ', more archers' };
function renderSetup() {
  const extra = extraGoblins(setupMode === 'campaign' ? squadMembers(camp) : practiceSquad());
  document.querySelectorAll<HTMLButtonElement>('[data-diff]').forEach(b => {
    const d = b.dataset.diff as Difficulty;
    b.classList.toggle('on', d === setup.diff);
    b.innerHTML = `${cap(d)}<small>${BALANCE.difficulty[d].roster.length + extra} goblins${extra ? '' : DIFF_NOTE[d]}</small>`;
  });
  $('adaptNote').textContent = extra
    ? `Your squad is strong, so ${extra} extra ${extra === 1 ? 'goblin joins' : 'goblins join'} the horde. Levels, promotions and gear all count.`
    : '';
  document.querySelectorAll<HTMLButtonElement>('[data-theme]').forEach(b => b.classList.toggle('on', b.dataset.theme === setup.theme));
  const box = $('slots');
  box.innerHTML = '';
  squad.forEach((m, i) => {
    const slot = document.createElement('div');
    slot.className = 'slot';
    const classes = HERO_CLASSES.map(c => `<button class="btn${m.cls === c ? ' on' : ''}" type="button" data-slot="${i}" data-cls="${c}" aria-pressed="${m.cls === c}">${CLASSES[c].label}</button>`).join('');
    const paths = [undefined, ...PATHS_OF[m.cls]].map(p => `<button class="btn${m.path === p ? ' on' : ''}" type="button" data-slot="${i}" data-path="${p ?? ''}" aria-pressed="${m.path === p}">${p ? PATHS[p].label : 'Basic'}</button>`).join('');
    slot.innerHTML = `<div class="classes" role="group" aria-label="Hero ${i + 1} class">${classes}</div>` +
      `<div class="paths3" role="group" aria-label="Hero ${i + 1} path">${paths}</div>` +
      `<div class="nameRow"><input type="text" maxlength="14" aria-label="Hero ${i + 1} name" value="${esc(m.name)}" data-name="${i}">` +
      `<button class="btn dice" type="button" data-dice="${i}" aria-label="Random name">🎲</button></div>`;
    box.appendChild(slot);
  });
  $<HTMLInputElement>('tipsToggle').checked = coach.enabled;
}

function classInfo(m: { cls: HeroClass; path?: PathId }) {
  const C = m.path ? { ...CLASSES[m.cls], ...PATHS[m.path].mod, label: PATHS[m.path].label } : CLASSES[m.cls];
  const blurb = m.path ? PATHS[m.path].blurb : C.blurb;
  const extra = C.extra ? ` <strong>${C.extra.name}</strong>: ${C.extra.desc}` : '';
  $('classInfo').innerHTML = `<strong>${C.label}</strong>: ${blurb} ${C.hp}♥, walks ${C.move}, ${C.range === 1 ? 'melee' : 'range ' + C.range}, ${C.dmg} damage. <strong>${C.ability!.name}</strong>: ${C.ability!.desc}${extra}` +
    (m.path ? ' Practice promoted heroes are level 3.' : '');
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
    classInfo(squad[i]);
  } else if (b.dataset.path !== undefined) {
    const i = Number(b.dataset.slot);
    squad[i] = { ...squad[i], path: (b.dataset.path || undefined) as PathId | undefined };
    classInfo(squad[i]);
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

$('newBtn').addEventListener('click', () => { unlockAudio(); play('click'); showCamp(); });
$('practiceBtn').addEventListener('click', () => { unlockAudio(); play('click'); showSetup('practice'); });
$('backBtn').addEventListener('click', () => (setupMode === 'campaign' ? showCamp() : showStart()));
$('continueBtn').addEventListener('click', () => {
  unlockAudio();
  const saved = loadSave();
  if (!saved) { showStart(); return; }
  begin(saved);
});
$('startBtn').addEventListener('click', () => {
  unlockAudio();
  const tipsOn = $<HTMLInputElement>('tipsToggle').checked;
  if (tipsOn !== coach.enabled) coach.reset(tipsOn);
  try { localStorage.setItem(SETUP_KEY, JSON.stringify(setup)); } catch { /* ignore */ }
  const theme: Theme = setup.theme === 'random' ? (Math.random() < 0.5 ? 'village' : 'forest') : setup.theme;
  const seed = (Math.random() * 2 ** 31) >>> 0;
  if (setupMode === 'campaign') {
    begin(createGame({ seed, diff: setup.diff, theme, squad: squadMembers(camp), mode: 'campaign' }));
    return;
  }
  squad = squad.map(m => ({ cls: m.cls, name: m.name.trim().slice(0, 14) || randomName(m.cls, []), path: m.path }));
  try { localStorage.setItem(SQUAD_KEY, JSON.stringify(squad)); } catch { /* ignore */ }
  begin(createGame({ seed, diff: setup.diff, theme, squad: practiceSquad(), mode: 'practice' }));
});
$('againBtn').addEventListener('click', () => {
  if (s.match) leaveLink();
  if (s.mode === 'practice') showStart(); else showCamp();
});


/* ---------- Play together: two phones ---------- */

interface Lobby {
  kind: 'coop' | 'duel';
  theme: Theme | 'random';
  diff: Difficulty;
  fair: boolean;
  names: [string, string];
  picks: [SquadMember[], SquadMember[]];
  ready: [boolean, boolean];
}
let lobby: Lobby | null = null;
let lastLobby: Lobby | null = null; // the settings of the last game, for a rematch
let myPicks: string[] = [];          // Barracks hero ids this phone brings
let resumeMatch: SavedMatch | null = null; // set by Continue together

const myName = () => ($<HTMLInputElement>('myName').value.trim().slice(0, 12) || 'Player');
const pickCount = () => (lobby?.kind === 'duel' ? PROGRESS.squadSize : 2);
const lobbySeat = () => (net.link?.host ? 0 : 1);

function showTogether(note = '') {
  try { $<HTMLInputElement>('myName').value = localStorage.getItem(NAME_KEY) || ''; } catch { /* ignore */ }
  $('joinBox').hidden = true;
  $('tgNote').innerHTML = note;
  showOnly('together');
}
function rememberName() {
  try { localStorage.setItem(NAME_KEY, myName()); } catch { /* ignore */ }
}

// Start talking to the other phone. `want`: make the room, join it, or whichever works (resuming)
function startLink(code: string, want: 'host' | 'join' | 'either') {
  if (net.link) net.link.stop();
  net.left = false;
  net.code = code;
  net.tries = 0;
  const link = new Link(code, {
    message: m => onNetMessage(link, m as NetMsg),
    open: () => onNetOpen(link),
    close: () => onNetClose(link),
    error: text => onNetError(link, text)
  });
  net.link = link;
  link.start(want);
}
function leaveLink() {
  if (!net.link) return;
  net.link.send({ t: 'bye' });
  const l = net.link;
  net.link = null;
  setTimeout(() => l.stop(), 300);
}

type NetMsg =
  | { t: 'hello'; name: string; resume: { battleId?: number; seq: number; seat: number } | null }
  | { t: 'lobby'; lobby: Lobby }
  | { t: 'pick'; squad: SquadMember[]; ready: boolean }
  | { t: 'start'; state: GameState; seat: number }
  | { t: 'sendState' }
  | { t: 'state'; state: GameState; seat: number }
  | { t: 'act'; a: Act; n?: number; seq: number; h: number }
  | { t: 'reject'; n?: number }
  | { t: 'resync' }
  | { t: 'rematch' }
  | { t: 'bye' };

// The game this phone would carry on with: the battle on screen, or the one picked from Continue together
function currentMatch(): SavedMatch | null {
  if (s.match && s.phase !== 'over' && $('end').hidden && net.seat !== undefined && inBattle()) return { code: net.code, seat: net.seat, state: s };
  return resumeMatch;
}
const inBattle = () => overlays.every(o => $(o).hidden);

function onNetOpen(link: Link) {
  if (link !== net.link) return;
  net.tries = 0;
  net.left = false;
  if (!link.host) {
    const cur = currentMatch();
    link.send({ t: 'hello', name: myName(), resume: cur ? { battleId: cur.state.battleId, seq: cur.state.match!.seq, seat: cur.seat } : null });
  }
  renderLobby();
  renderNetBar();
}

function onNetClose(link: Link) {
  if (link !== net.link) return;
  renderNetBar();
  if (!$('lobby').hidden) { $('lobbyStatus').innerHTML = `${esc(net.partner || 'The other phone')} left the room.`; renderLobby(); }
  // In a battle, the phone that joined keeps trying to link up again; the host waits for it
  if (s.match && inBattle() && !link.host) reconnectSoon();
}

function onNetError(link: Link, text: string) {
  if (link !== net.link) return;
  if (s.match && inBattle()) { reconnectSoon(); return; }
  net.link = null;
  link.stop();
  showTogether(text);
}

let retryTimer = 0;
function reconnectSoon() {
  clearTimeout(retryTimer);
  if (net.tries >= 6) { renderNetBar(); return; }
  retryTimer = window.setTimeout(() => {
    if (!s.match || !inBattle() || net.link?.connected) return;
    net.tries++;
    const tries = net.tries;
    startLink(net.code, 'either');
    net.tries = tries;
    renderNetBar();
  }, 1500 + net.tries * 1500);
}

function onNetMessage(link: Link, m: NetMsg) {
  if (link !== net.link || !m || typeof m !== 'object') return;
  switch (m.t) {
    case 'hello': return gotHello(m);
    case 'lobby':
      if (link.host) return;
      gotLobby(m.lobby);
      return;
    case 'pick':
      if (!link.host || !lobby) return;
      lobby.picks[1] = Array.isArray(m.squad) ? m.squad.slice(0, PROGRESS.squadSize) : [];
      lobby.ready[1] = !!m.ready && lobby.picks[1].length === pickCount();
      sendLobby();
      maybeStartMatch();
      return;
    case 'start': {
      if (link.host) return;
      const st = m.state;
      if (!st || !st.match) return;
      // Same battle already on screen: just catch up
      if (s.match && inBattle() && s.battleId === st.battleId && net.seat === m.seat) {
        enqueue(async () => { s = st; view.load(s); U.waiting = 0; save(); renderAll(); if (playersTurn(s, net.seat) && !U.sel) startPlayerTurn(); });
        return;
      }
      resumeMatch = null;
      if (lobby) lastLobby = lobby;
      lobby = null;
      begin(st, m.seat);
      return;
    }
    case 'sendState': {
      const cur = currentMatch();
      if (cur) link.send({ t: 'state', state: cur.state, seat: cur.seat });
      return;
    }
    case 'state':
      if (!link.host || !m.state?.match) return;
      startMatch(m.state, 1 - m.seat);
      return;
    case 'act':
      if (link.host) { if (s.match && net.seat !== undefined && inBattle()) commit(m.a, m.n, 1 - net.seat).then(hostLoop); }
      else if (s.match && inBattle()) received(m);
      return;
    case 'reject':
      if (m.n && m.n === U.waiting) { U.waiting = 0; resetUi(); renderAll(); banner("That move didn't work"); }
      return;
    case 'resync':
      if (link.host && s.match && net.seat !== undefined) link.send({ t: 'start', state: s, seat: 1 - net.seat });
      return;
    case 'rematch':
      if (link.host) openLobby(true);
      return;
    case 'bye':
      net.partner = net.partner || partnerName();
      net.left = true;
      link.stop();
      if (net.link === link) net.link = null;
      if (!$('lobby').hidden) { $('lobbyStatus').innerHTML = `${esc(net.partner)} left the room.`; renderLobby(); }
      renderNetBar();
      return;
  }
}

// The host: the other phone said hello. Carry on a game, or open the lobby for a new one.
function gotHello(m: Extract<NetMsg, { t: 'hello' }>) {
  net.partner = String(m.name || 'Player').slice(0, 12);
  const mine = currentMatch(), theirs = m.resume;
  if (mine) {
    if (theirs && theirs.battleId === mine.state.battleId && theirs.seq > mine.state.match!.seq) { net.link?.send({ t: 'sendState' }); return; }
    startMatch(mine.state, mine.seat);
    return;
  }
  openLobby(false);
}

// Host: send the game to the other phone and play it here too
function startMatch(state: GameState, mySeat: number) {
  net.link?.send({ t: 'start', state, seat: 1 - mySeat });
  resumeMatch = null;
  if (lobby) lastLobby = lobby;
  lobby = null;
  if (s === state && inBattle()) { renderAll(); hostLoop(); return; }
  begin(state, mySeat);
}

function defaultPicks(n: number): string[] {
  const order = [...camp.squad, ...camp.heroes.map(h => h.id).filter(id => !camp.squad.includes(id))];
  return order.filter(id => camp.heroes.some(h => h.id === id)).slice(0, n);
}
const pickedMembers = (): SquadMember[] => squadMembers({ ...camp, squad: myPicks });

function openLobby(rematch: boolean) {
  const old = lobby ?? lastLobby;
  lobby = {
    kind: old?.kind ?? 'coop', theme: old?.theme ?? setup.theme, diff: old?.diff ?? setup.diff, fair: old?.fair ?? false,
    names: [myName(), net.partner || 'Player'], picks: [[], []], ready: [false, false]
  };
  myPicks = defaultPicks(pickCount());
  lobby.picks[0] = pickedMembers();
  if (rematch || old) $('lobbyStatus').innerHTML = '';
  sendLobby();
  showLobby();
}
function sendLobby() {
  if (net.link?.host && lobby) net.link.send({ t: 'lobby', lobby });
  renderLobby();
}
function gotLobby(l: Lobby) {
  const kindChanged = !lobby || lobby.kind !== l.kind;
  lobby = l;
  net.partner = l.names[0];
  if (kindChanged || myPicks.length !== pickCount() || !myPicks.every(id => camp.heroes.some(h => h.id === id))) myPicks = defaultPicks(pickCount());
  // New game type: tell the host which heroes we bring now
  if (kindChanged || l.picks[1].length !== myPicks.length) net.link?.send({ t: 'pick', squad: pickedMembers(), ready: l.ready[1] });
  if ($('lobby').hidden) showLobby();
  else renderLobby();
}

function showLobby() {
  showOnly('lobby');
  renderLobby();
}

function renderLobby() {
  const link = net.link;
  const host = !!link?.host;
  const code = net.code;
  $('roomCode').textContent = code;
  const connected = !!link?.connected;
  $('lobbyWait').hidden = connected && !!lobby;
  $('lobbySetup').hidden = !lobby || !connected;
  if (!connected || !lobby) {
    $('lobbyStatus').innerHTML ||= host || !link
      ? `On the other phone, tap <strong>Play together</strong>, then <strong>Join a game</strong>, and type <strong>${code}</strong>.`
      : 'Linking up with the other phone…';
    return;
  }
  const seat = lobbySeat(), other = 1 - seat;
  const n = pickCount();
  $('lobbyTitle').textContent = `${lobby.names[0]} and ${lobby.names[1]}`;
  // Settings: the phone that made the room chooses
  document.querySelectorAll<HTMLButtonElement>('[data-kind]').forEach(b => {
    b.classList.toggle('on', b.dataset.kind === lobby!.kind);
    b.disabled = !host;
  });
  document.querySelectorAll<HTMLButtonElement>('[data-lmap]').forEach(b => {
    b.classList.toggle('on', b.dataset.lmap === lobby!.theme);
    b.disabled = !host;
  });
  document.querySelectorAll<HTMLButtonElement>('[data-ldiff]').forEach(b => {
    b.classList.toggle('on', b.dataset.ldiff === lobby!.diff);
    b.disabled = !host;
  });
  $('lobbyDiffBox').hidden = lobby.kind !== 'coop';
  $('fairBox').hidden = lobby.kind !== 'duel';
  $<HTMLInputElement>('fairToggle').checked = lobby.fair;
  $<HTMLInputElement>('fairToggle').disabled = !host;
  $('kindNote').textContent = lobby.kind === 'coop'
    ? 'Team up against the goblins. You each bring 2 heroes and move them in the same turn. It counts like a camp battle: XP, gold and a loot chest each, and heroes who fall are gone for good.'
    : `Your squad against ${lobby.names[other]}'s, taking turns. A coin flip picks who goes first. Nobody is lost and no XP is earned; the winner gets ${PROGRESS.gold.duelWin} gold.` +
      (lobby.fair ? ' Fair fight: everyone is a level 1 hero with no gear.' : '');
  if (!host) $('lobbyHostNote').textContent = `${lobby.names[0]} picks the game and the map.`;
  $('lobbyHostNote').hidden = host;
  // Hero picks
  $('lobbyPickLbl').textContent = `Bring ${n} heroes from your Barracks (${myPicks.length} of ${n})`;
  $('lobbyHeroes').innerHTML = camp.heroes.map(h => {
    const i = myPicks.indexOf(h.id);
    return `<div class="heroCard${i >= 0 ? ' picked' : ''}" role="button" tabindex="0" aria-pressed="${i >= 0}" data-lpick="${h.id}">` +
      `<b>${esc(h.name)}</b><span class="cls">Level ${levelOf(h.xp)} ${heroLabel(h)}</span>` +
      `<span class="stats"><span class="f">♥</span>${heroHp(h)}</span>` +
      `<span class="gearRow">${gearList(h).map(id => `<span>${ICON[id]}</span>`).join('')}</span>` +
      (i >= 0 ? `<span class="num">${i + 1}</span>` : '') + '</div>';
  }).join('');
  const theirs = lobby.picks[other];
  $('lobbyPeer').innerHTML = `<strong>${esc(lobby.names[other])}</strong>: ` +
    (theirs.length ? theirs.map(m => `${esc(m.name)} <small>(${heroLabel(m)})</small>`).join(', ') : 'picking heroes…') +
    (lobby.ready[other] ? ' · <span class="ok">Ready!</span>' : '');
  const ready = lobby.ready[seat];
  const rb = $<HTMLButtonElement>('lobbyReady');
  rb.disabled = myPicks.length !== n;
  rb.textContent = ready ? `Waiting for ${lobby.names[other]}…` : lobby.ready[other] ? "Ready! Let's go" : 'Ready';
  rb.classList.toggle('on', ready);
  $('lobbyStatus').innerHTML = '';
}

function lobbyChanged() {
  if (!lobby || !net.link?.host) return;
  lobby.ready = [false, false];
  sendLobby();
}
document.querySelectorAll<HTMLButtonElement>('[data-kind]').forEach(b => b.addEventListener('click', () => {
  if (!lobby || !net.link?.host) return;
  play('click');
  lobby.kind = b.dataset.kind as Lobby['kind'];
  myPicks = defaultPicks(pickCount());
  lobby.picks = [pickedMembers(), []];
  lobbyChanged();
}));
document.querySelectorAll<HTMLButtonElement>('[data-lmap]').forEach(b => b.addEventListener('click', () => {
  if (!lobby || !net.link?.host) return;
  play('click');
  lobby.theme = b.dataset.lmap as Lobby['theme'];
  lobbyChanged();
}));
document.querySelectorAll<HTMLButtonElement>('[data-ldiff]').forEach(b => b.addEventListener('click', () => {
  if (!lobby || !net.link?.host) return;
  play('click');
  lobby.diff = b.dataset.ldiff as Difficulty;
  lobbyChanged();
}));
$('fairToggle').addEventListener('change', () => {
  if (!lobby || !net.link?.host) return;
  lobby.fair = $<HTMLInputElement>('fairToggle').checked;
  lobbyChanged();
});
$('lobbyHeroes').addEventListener('click', e => {
  const card = (e.target as HTMLElement).closest<HTMLElement>('[data-lpick]');
  if (!card || !lobby) return;
  play('click');
  const id = card.dataset.lpick!;
  if (myPicks.includes(id)) myPicks = myPicks.filter(x => x !== id);
  else if (myPicks.length < pickCount()) myPicks.push(id);
  sendPicks(false);
});
function sendPicks(ready: boolean) {
  if (!lobby) return;
  const seat = lobbySeat();
  lobby.picks[seat] = pickedMembers();
  lobby.ready[seat] = ready;
  if (net.link?.host) { sendLobby(); maybeStartMatch(); }
  else { net.link?.send({ t: 'pick', squad: lobby.picks[seat], ready }); renderLobby(); }
}
$('lobbyReady').addEventListener('click', () => {
  if (!lobby) return;
  unlockAudio();
  play('click');
  sendPicks(!lobby.ready[lobbySeat()]);
});
$('lobbyLeave').addEventListener('click', () => {
  play('click');
  leaveLink();
  lobby = null;
  showTogether();
});

// Host: both players are ready, so make the battle
function maybeStartMatch() {
  if (!lobby || !net.link?.host || !lobby.ready[0] || !lobby.ready[1]) return;
  const n = pickCount();
  if (lobby.picks[0].length !== n || lobby.picks[1].length !== n) return;
  const seed = (Math.random() * 2 ** 31) >>> 0;
  const theme: Theme = lobby.theme === 'random' ? (Math.random() < 0.5 ? 'village' : 'forest') : lobby.theme;
  const clean = (m: SquadMember, player: number): SquadMember => {
    const base = { cls: m.cls, name: String(m.name).slice(0, 14), player };
    return lobby!.fair ? base : { ...base, path: m.path, level: m.level, heroId: m.heroId, gear: m.gear };
  };
  let state: GameState;
  if (lobby.kind === 'coop') {
    const squad = [...lobby.picks[0].map(m => clean(m, 0)), ...lobby.picks[1].map(m => clean(m, 1))];
    state = createGame({ seed, diff: lobby.diff, theme, squad, mode: 'coop', match: { names: lobby.names, teams: ['hero', 'hero'], seq: 0 } });
  } else {
    // Coin flip: who goes first (and starts at the near end of the map)
    const first = Math.random() < 0.5 ? 0 : 1;
    const teams: [Team, Team] = first === 0 ? ['hero', 'gob'] : ['gob', 'hero'];
    state = createGame({
      seed, diff: 'normal', theme, mode: 'duel', squad: lobby.picks[first].map(m => clean(m, first)),
      squad2: lobby.picks[1 - first].map(m => clean(m, 1 - first)), match: { names: lobby.names, teams, seq: 0, fair: lobby.fair }
    });
  }
  startMatch(state, 0);
}

$('togetherBtn').addEventListener('click', () => { unlockAudio(); play('click'); resumeMatch = null; showTogether(); });
$('togetherBack').addEventListener('click', () => { play('click'); showStart(); });
$('hostBtn').addEventListener('click', () => {
  unlockAudio();
  play('click');
  rememberName();
  resumeMatch = null;
  lobby = null;
  $('lobbyStatus').innerHTML = '';
  startLink(newRoomCode(), 'host');
  showLobby();
});
$('joinOpenBtn').addEventListener('click', () => {
  play('click');
  $('joinBox').hidden = false;
  $<HTMLInputElement>('joinCode').focus();
});
$('joinCode').addEventListener('input', () => {
  const inp = $<HTMLInputElement>('joinCode');
  inp.value = cleanCode(inp.value);
});
$('joinCode').addEventListener('keydown', e => { if (e.key === 'Enter') $('joinBtn').click(); });
$('joinBtn').addEventListener('click', () => {
  unlockAudio();
  const code = cleanCode($<HTMLInputElement>('joinCode').value);
  if (code.length !== 4) { $('tgNote').textContent = 'Room codes are 4 letters.'; return; }
  play('click');
  rememberName();
  resumeMatch = null;
  lobby = null;
  $('lobbyStatus').innerHTML = '';
  startLink(code, 'join');
  showLobby();
});
$('continueTogetherBtn').addEventListener('click', () => {
  unlockAudio();
  const m = loadMatch();
  if (!m) { showStart(); return; }
  play('click');
  resumeMatch = m;
  lobby = null;
  $('lobbyStatus').innerHTML = `Linking up to carry on with ${esc(m.state.match!.names[1 - m.seat])}. On the other phone, tap <strong>Continue together</strong>, or <strong>Play together</strong> and join <strong>${m.code}</strong>.`;
  startLink(m.code, 'either');
  showLobby();
});
$('rematchBtn').addEventListener('click', () => {
  play('click');
  if (!net.link?.connected) { $('rematchBtn').textContent = 'The other phone left'; return; }
  if (net.link.host) openLobby(true);
  else net.link.send({ t: 'rematch' });
});

// The strip at the top of a two-phone battle while the link is down
function renderNetBar() {
  const bar = $('netBar');
  const down = !!s.match && inBattle() && s.phase !== 'over' && !net.link?.connected;
  bar.hidden = !down;
  if (!down) return;
  const giving = (net.tries >= 6 && !net.link?.host) || net.left;
  $('netText').textContent = net.left
    ? `${partnerName()} left the battle. It's saved, so you can both carry on later with Continue together.`
    : giving
    ? `Can't reach ${partnerName()}'s phone. Check the Wi-Fi on both phones.`
    : net.link?.host ? `Waiting for ${partnerName()}'s phone to link up again…` : `Lost the link to ${partnerName()}'s phone. Reconnecting…`;
  $('netRetry').hidden = !giving;
}
$('netRetry').addEventListener('click', () => { net.tries = 0; net.left = false; startLink(net.code, 'either'); renderNetBar(); });

function begin(state: GameState, seat?: number) {
  s = state;
  net.seat = s.match ? seat : undefined;
  if (!s.match) leaveLink();
  U.flags = new Set();
  U.busy = false;
  U.waiting = 0;
  foeLog = [];
  goblinNow = null;
  lastMover = null;
  showOnly(null);
  view.me = ME();
  view.seat = s.mode === 'coop' ? net.seat : undefined;
  view.load(s);
  save();
  if (checkEnd()) return;
  if (playersTurn(s, net.seat)) startPlayerTurn();
  else { resetUi(); U.sel = null; turnBanner(); renderAll(); }
  hostLoop();
}

try { $<HTMLInputElement>('myName').value = localStorage.getItem(NAME_KEY) || ''; } catch { /* ignore */ }

// The board behind the start screen
view.load(s);
renderPanel();
showStart();

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js').catch(() => {}); });
}

// Hooks for automated browser tests
(window as unknown as { __blockSquad: unknown }).__blockSquad = {
  state: () => s, ui: U, view, handleTap, confirmPending, endTurn: endMyTurn, coach, net, act, hash: () => stateHash(s),
  screenPos: (x: number, z: number) => view.screenPos(x, z)
};
