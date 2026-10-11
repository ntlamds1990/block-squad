// Learn-as-you-play tips for the first battle. Each tip pops up the first time its moment comes
// (a goblin in reach, a hero hurt, a fire starting) and never again once dismissed.
import { abilityOf, abilityTargets, attackTargets, canSee, living, moveAttackTargets } from '../rules/game';
import type { GameState, Unit } from '../rules/types';

const TIPS_KEY = 'blockSquad.tips';
const SEEN_KEY = 'blockSquad.tipsSeen';

export interface CoachCtx {
  s: GameState;
  sel: Unit | null;
  flags: Set<string>; // things that have happened this battle: moved, attacked, ability
}

interface Tip {
  id: string;
  text: (c: CoachCtx) => string;
  when: (c: CoachCtx) => boolean;
  doneWhen?: (c: CoachCtx) => boolean; // closes the tip on its own when the player does the thing
}

const heroName = (c: CoachCtx) => c.sel?.name ?? 'Your hero';
const seenGob = (c: CoachCtx, cls: string) => living(c.s, 'gob').some(g => g.cls === cls && canSee(c.s, 'hero', g));
const hasWell = (s: GameState) => s.tiles.some(r => r.some(t => t.blocks.includes('well')));

const TIPS: Tip[] = [
  {
    id: 'fog',
    when: c => c.s.theme === 'forest',
    text: () => 'The <strong>Dark Forest</strong> is foggy. You only see goblins close to your heroes, so creep forward carefully.'
  },
  {
    id: 'move',
    when: c => c.s.phase === 'player' && !!c.sel,
    doneWhen: c => c.flags.has('moved'),
    text: c => `<strong>${heroName(c)}</strong> is ready (yellow ring). Blue tiles show where they can walk. <strong>Tap a blue tile</strong> to plan a route, then tap the same tile again to walk. Tapping twice works for attacks and abilities too.`
  },
  {
    id: 'actions',
    when: c => c.flags.has('moved'),
    text: () => 'Each hero gets <strong>2 actions</strong> a turn. Walking uses 1. Attacking or using an ability ends that hero\'s turn.'
  },
  {
    id: 'cover',
    when: c => c.flags.has('moved'),
    text: () => '<strong>Walls and trees are cover.</strong> Stand right next to one and goblins on the other side will miss a lot more. Tall walls are best.'
  },
  {
    id: 'attack',
    when: c => c.s.phase === 'player' && living(c.s, 'hero').some(h => attackTargets(c.s, h).length > 0 || moveAttackTargets(c.s, h).length > 0),
    doneWhen: c => c.flags.has('attacked'),
    text: () => 'A goblin is in reach! Its tile glows <strong>red</strong>. Tap it to see your chance to hit, then tap it again to attack. Faded red means walk and attack in one go.'
  },
  {
    id: 'graze',
    when: c => c.flags.has('attacked'),
    text: () => 'Even a miss <strong>grazes</strong> for 1 damage. Tap any goblin to see how far it can move (purple tiles).'
  },
  {
    id: 'next',
    when: c => c.s.phase === 'player' && c.s.turn === 1 && living(c.s, 'hero').some(h => h.ap === 0) && living(c.s, 'hero').some(h => h.ap > 0),
    text: () => 'Pick your next hero in the bar at the bottom. The turn ends by itself when everyone has acted, or press <strong>End turn</strong>.'
  },
  {
    id: 'shaman',
    when: c => seenGob(c, 'shaman'),
    text: () => 'That purple goblin is a <strong>Shaman</strong>. It heals goblins and summons more of them. Take it out early!'
  },
  {
    id: 'troll',
    when: c => seenGob(c, 'troll'),
    text: () => 'A <strong>Troll</strong>! It smashes straight through walls, so cover won\'t keep it out. It has lots of hearts but moves slowly.'
  },
  {
    id: 'overwatch',
    when: c => c.s.phase === 'player' && c.s.turn >= 2,
    text: () => 'No goblin in reach? Press <strong>Overwatch</strong>. The hero waits on guard and shoots the first goblin that walks into range.'
  },
  {
    id: 'ability',
    when: c => c.s.phase === 'player' && c.s.turn >= 2 && living(c.s, 'hero').some(h => h.cd <= 0 && h.ap > 0 && abilityOf(h)?.key !== 'build' && abilityTargets(c.s, h).length > 0),
    doneWhen: c => c.flags.has('ability'),
    text: c => {
      const h = living(c.s, 'hero').find(h => h.cd <= 0 && abilityOf(h)?.key !== 'build' && abilityTargets(c.s, h).length > 0)!;
      return `<strong>${h.name}'s ${abilityOf(h)!.name}</strong> is ready. Select ${h.name} and press the ability button to see what it does.`;
    }
  },
  {
    id: 'hurt',
    when: c => living(c.s, 'hero').some(h => h.maxHp - h.hp >= 2),
    text: c => {
      const cleric = living(c.s, 'hero').find(h => h.cls === 'cleric');
      const parts = [];
      if (cleric) parts.push(`${cleric.name} the Cleric can <strong>Heal</strong> 2 hearts`);
      if (hasWell(c.s)) parts.push('standing next to the <strong>well</strong> heals 1 heart every turn');
      return 'A hero is hurt. ' + (parts.length ? parts.join(', and ') + '.' : 'Pull them back behind cover.');
    }
  },
  {
    id: 'fire',
    when: c => c.s.tiles.some(r => r.some(t => t.fire > 0)),
    text: () => '<strong>Fire!</strong> Burning tiles hurt anyone who stands in them, and fire spreads to wood and hay. Wait for it to burn out, or walk around it.'
  }
];

export function tipsEnabled(): boolean {
  try { return localStorage.getItem(TIPS_KEY) !== 'off'; } catch { return true; }
}
export function setTipsEnabled(on: boolean) {
  try { localStorage.setItem(TIPS_KEY, on ? 'on' : 'off'); } catch { /* ignore */ }
}
function readSeen(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) || '[]')); } catch { return new Set(); }
}
function writeSeen(seen: Set<string>) {
  try { localStorage.setItem(SEEN_KEY, JSON.stringify([...seen])); } catch { /* ignore */ }
}

export class Coach {
  private seen = readSeen();
  private current: Tip | null = null;
  enabled = tipsEnabled();

  constructor(private box: HTMLElement, private textEl: HTMLElement, ok: HTMLElement, skip: HTMLElement, private onChange: () => void) {
    ok.addEventListener('click', () => this.dismiss());
    skip.addEventListener('click', () => {
      this.enabled = false;
      setTipsEnabled(false);
      this.hide();
      this.onChange();
    });
  }

  get showing() { return this.current?.id ?? null; }

  // Restart the tips (from the setup screen toggle)
  reset(on: boolean) {
    this.enabled = on;
    setTipsEnabled(on);
    if (on) { this.seen = new Set(); writeSeen(this.seen); }
    this.hide();
  }

  update(c: CoachCtx) {
    if (!this.enabled || c.s.phase === 'over') { this.hide(); return; }
    if (this.current) {
      if (this.current.doneWhen?.(c)) this.dismiss(c);
      else { this.textEl.innerHTML = this.current.text(c); return; }
    }
    if (c.s.phase !== 'player') return;
    const tip = TIPS.find(t => !this.seen.has(t.id) && t.when(c));
    if (!tip) return;
    this.current = tip;
    this.textEl.innerHTML = tip.text(c);
    this.box.hidden = false;
  }

  private dismiss(c?: CoachCtx) {
    if (this.current) { this.seen.add(this.current.id); writeSeen(this.seen); }
    this.hide();
    if (c) this.update(c); else this.onChange();
  }

  // After the first battle every tip has had its chance; turn tips off for the next one
  finishBattle() {
    if (this.seen.size >= 6) { this.enabled = false; setTipsEnabled(false); }
    this.hide();
  }

  private hide() {
    this.current = null;
    this.box.hidden = true;
  }
}
