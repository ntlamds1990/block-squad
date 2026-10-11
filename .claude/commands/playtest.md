---
description: Simulate CPU vs CPU battles and report hero win rates per difficulty and map
---

Run `npm run playtest -- ${ARGUMENTS:-100}` in the repo root and report the results as a short
table. Compare each difficulty with its target hero win rate (Easy ~85%, Normal ~60%, Hard ~35%).
If any is more than about 5 points off, suggest a specific change to `app/src/rules/balance.ts`
(one number at a time), apply it only if asked, then re-run to confirm.
