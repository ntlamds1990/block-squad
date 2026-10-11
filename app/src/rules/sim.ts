// CPU vs CPU battles for balancing. The heroes are played by the same brain as the goblins,
// as a stand-in for a real player.
import type { Difficulty } from './balance';
import { DEFAULT_SQUAD } from './balance';
import { runUnitTurn, turnOrder } from './ai';
import { createGame, endEnemyTurn, endPlayerTurn, living, type SquadMember } from './game';
import type { GameState, Theme } from './types';

export interface BattleResult { winner: 'hero' | 'gob' | 'draw'; turns: number; heroesLeft: number; state: GameState }

export const MAX_TURNS = 40;
const over = (s: GameState) => s.phase === 'over';

export function runBattle(o: { seed: number; diff: Difficulty; theme: Theme; squad?: SquadMember[]; heroNoise?: number }): BattleResult {
  const s = createGame({ seed: o.seed, diff: o.diff, theme: o.theme, squad: o.squad ?? DEFAULT_SQUAD });
  while (!over(s) && s.turn <= MAX_TURNS) {
    for (const h of turnOrder(s, 'hero')) {
      if (over(s)) break;
      runUnitTurn(s, h, { noise: o.heroNoise });
    }
    if (over(s)) break;
    endPlayerTurn(s);
    for (const g of turnOrder(s, 'gob')) {
      if (over(s)) break;
      runUnitTurn(s, g);
    }
    if (over(s)) break;
    endEnemyTurn(s);
  }
  return { winner: s.winner ?? 'draw', turns: s.turn, heroesLeft: living(s, 'hero').length, state: s };
}
