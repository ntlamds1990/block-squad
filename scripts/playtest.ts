/// <reference types="node" />
// Balance check: plays many CPU vs CPU battles and prints hero win rates.
// Usage: npm run playtest [-- battlesPerSetting]
import { runBattle } from '../app/src/rules/sim';
import { DEFAULT_SQUAD, HERO_CLASSES, NAME_POOL, type Difficulty, type HeroClass } from '../app/src/rules/balance';
import type { Theme } from '../app/src/rules/types';

const N = Number(process.argv[2] ?? 60);
const TARGET: Record<Difficulty, number> = { easy: 85, normal: 60, hard: 35 };
const pct = (a: number, b: number) => Math.round((a / b) * 100);

console.log(`Block Squad playtest: ${N} battles per setting, default squad (Knight, Archer, Mage, Cleric)\n`);
console.log('difficulty  theme    hero win%  target  draws  avg turns  heroes left');
for (const diff of ['easy', 'normal', 'hard'] as Difficulty[]) {
  for (const theme of ['village', 'forest'] as Theme[]) {
    let wins = 0, draws = 0, turns = 0, left = 0;
    for (let i = 0; i < N; i++) {
      const r = runBattle({ seed: 1000 + i, diff, theme });
      if (r.winner === 'hero') { wins++; left += r.heroesLeft; }
      if (r.winner === 'draw') draws++;
      turns += r.turns;
    }
    console.log(`${diff.padEnd(11)} ${theme.padEnd(8)} ${String(pct(wins, N)).padStart(8)}%  ${String(TARGET[diff]).padStart(5)}%  ${String(draws).padStart(5)}  ${(turns / N).toFixed(1).padStart(9)}  ${(wins ? left / wins : 0).toFixed(1).padStart(11)}`);
  }
}

console.log('\nFourth hero swapped (Knight, Archer, Mage + one more; Normal, both maps): shows each class\'s value');
for (const cls of HERO_CLASSES) {
  const squad = [...DEFAULT_SQUAD.slice(0, 3), { cls: cls as HeroClass, name: NAME_POOL[cls as HeroClass][1] }];
  let wins = 0;
  for (let i = 0; i < N; i++) for (const theme of ['village', 'forest'] as Theme[]) if (runBattle({ seed: 5000 + i, diff: 'normal', theme, squad }).winner === 'hero') wins++;
  console.log(`  + ${cls.padEnd(8)} ${pct(wins, N * 2)}%`);
}
