---
name: game-rules
description: Block Squad's game rules and balance numbers. Use before changing classes, abilities, goblins, maps, difficulty or the CPU, or when answering how a rule works.
---

# Block Squad rules

The rules live in `app/src/rules/`, which has no graphics code, so the CPU, the tests and the
playtest simulator all use exactly the same rules as the real game.

- `balance.ts` is the single source of truth for every number: class stats, abilities, cover,
  hit chances, fire, the well, Troll and Shaman settings, and each difficulty's goblin roster.
  Change balance here and nowhere else.
- `game.ts` holds the rules. Every action (`performMove`, `performAttack`, `performAbility`, ...)
  changes the state and returns a list of events; the screen animates those events.
- `ai.ts` is the CPU brain (`chooseAction`, `applyAction`), used for goblins and for simulated heroes.
- `map.ts` builds random maps: one half is generated and mirrored, and every open tile must be reachable.
- `rng.ts` is the seeded random generator kept inside the state, so saves resume exactly.

## Core rules

- 2 actions per hero per turn. Walking costs 1. Attacking, Overwatch and most abilities end the turn.
  Build and Dig cost 1 action.
- Hit chance = aim, minus 25 for half cover or 45 for full cover, plus 10 for a ranged shot at an
  uncovered target, minus 5 per tile beyond 5, limited to 10–95%. A miss grazes for 1.
- Tall walls block line of sight, except walls right next to the shooter or the target.
- Overwatch shoots the first enemy that moves in range, at -15 aim. A hit (not a graze) has a 50% chance to stop the mover where it stands. Taking an attack or ability hit ends a unit's Overwatch.
- Fire burns 1 per round for anyone standing in it, burns wood/hay/leaves away and can spread.
- Standing next to a well heals 1 at the start of your turn.
- Dark Forest fog: heroes see 4.5 tiles, goblins 6.
- Knight: Shield (-1 damage from arrows, bolts and area spells, min 1), Charge (move-then-attack reaches 1 extra tile, +1 damage), Spin Attack 3 damage to every adjacent goblin.
- Momentum (Knight, Builder): a melee defeat (sword, pickaxe or Spin) gives back 1 action.
- Builder: Build makes a tall wall in 1 action; Turret (1 action, one per Builder, up to 2 tiles away) has 3 hearts and shoots at the end of each player turn. Turrets don't count as heroes for winning or losing.
- Trolls walk through walls (2 movement per wall, destroying it). Shamans heal goblins for 2 and summon up to 2 small goblins.

## After changing rules or balance

1. Add or update a test in `tests/` for the rule.
2. Run `npm test`.
3. Run `/playtest` and check the hero win rates against the targets: Easy ~85%, Normal ~60%, Hard ~35%.
