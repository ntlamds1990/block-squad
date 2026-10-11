# Block Squad

Blocky fantasy squad tactics for phones. Build a squad of four heroes and drive the Goblin Horde out of the realm.

**Play:** https://ntlamds1990.github.io/block-squad/ — open in Chrome on Android and tap **Add to Home screen**. No login needed, games save on the phone, and it works offline after the first visit.

## Milestone 1

- Squad builder: pick and name 4 heroes from Knight, Archer, Mage, Builder and Cleric.
- Goblins, Goblin Archers, Shamans (heal and summon) and Trolls (smash through walls).
- Two maps, random every battle: the Village (fire spreads through wood and hay, a healing well) and the Dark Forest (fog).
- Easy, Normal and Hard, tuned with simulated battles.
- Learn-as-you-play tips in the first battle, sound effects with a mute button, auto-save and Continue.

## Working on it

```
npm install
npm run dev        # play locally
npm test           # rules tests
npm run playtest   # CPU vs CPU battles: hero win rate per difficulty
npm run build      # production build into dist/
```

Every push to `main` runs the tests and deploys to GitHub Pages (`.github/workflows/deploy.yml`).
The rules are in `app/src/rules/` (no graphics code) and every balance number is in `app/src/rules/balance.ts`.

Built with [Three.js](https://threejs.org) r128 (MIT).
