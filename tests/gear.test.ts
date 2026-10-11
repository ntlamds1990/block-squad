import { describe, expect, it } from 'vitest';
import { abilityOf, addUnit, createGame, def, heroMaxHp, hitInfo, living, performAttack } from '../app/src/rules/game';
import { applyBattle, buy, equip, newCampaign, sell, squadMembers, unequip } from '../app/src/rules/campaign';
import { FORGE, ITEMS, ITEM_IDS, LOOT, rollChest, sellPrice, withGear } from '../app/src/rules/items';
import { CLASSES } from '../app/src/rules/balance';
import { blank, put } from './helpers';

const fixed = () => 0.5;

describe('items', () => {
  it('every weapon fits one class, and every item has a price', () => {
    for (const id of ITEM_IDS) {
      const it = ITEMS[id];
      expect(it.price).toBeGreaterThan(0);
      if (it.slot === 'weapon') expect(it.cls).toBeTruthy();
      else expect(it.cls).toBeUndefined();
    }
    expect(FORGE.every(id => ITEMS[id].rarity === 'common')).toBe(true);
  });

  it('gear changes stats: damage, aim, range, move and ability power', () => {
    const k = withGear(CLASSES.knight, ['steelSword', 'speedBoots']);
    expect(k.dmg).toBe(CLASSES.knight.dmg + 1);
    expect(k.aim).toBe(CLASSES.knight.aim + 10);
    expect(k.move).toBe(CLASSES.knight.move + 1);
    expect(k.range).toBe(1); // melee never gains range
    const a = withGear(CLASSES.archer, ['yewBow']);
    expect(a.range).toBe(CLASSES.archer.range + 1);
    const m = withGear(CLASSES.mage, ['stormStaff']);
    expect(m.ability!.amount).toBe(CLASSES.mage.ability!.amount! + 1);
    expect(m.ability!.cd).toBe(CLASSES.mage.ability!.cd - 1);
  });

  it('armour adds hearts in battle', () => {
    expect(heroMaxHp('knight', undefined, 1, ['chainmail'])).toBe(CLASSES.knight.hp + 2);
    const s = blank();
    const u = addUnit(s, 'knight', 'hero', [5, 5], 'K', undefined, { gear: ['leather', 'ironSword'] });
    expect(u.maxHp).toBe(CLASSES.knight.hp + 1);
    expect(def(u).dmg).toBe(CLASSES.knight.dmg + 1);
    expect(abilityOf(u)!.key).toBe('spin');
  });

  it('a Flaming Sword sets the target on fire', () => {
    const s = blank();
    const k = addUnit(s, 'knight', 'hero', [5, 5], 'K', undefined, { gear: ['flameSword'] });
    k.ap = 2;
    const g = put(s, 'troll', 'gob', 6, 5);
    for (let i = 0; i < 20 && !s.tiles[5][6].fire; i++) { k.ap = 2; performAttack(s, k, g); }
    expect(s.tiles[5][6].fire).toBeGreaterThan(0);
  });

  it('the Ring of Second Wind saves a hero once', () => {
    const s = blank();
    const h = addUnit(s, 'archer', 'hero', [5, 5], 'A', undefined, { gear: ['secondWind'] });
    const g = put(s, 'troll', 'gob', 6, 5);
    h.hp = 1;
    let saved = false;
    for (let i = 0; i < 40 && h.alive; i++) {
      g.ap = 2;
      performAttack(s, g, h);
      if (h.alive && h.hp === 1 && !h.secondWind) saved = true;
    }
    expect(saved).toBe(true);
    expect(h.secondWind).toBe(false);
  });

  it('a Healing Potion is drunk at 1 heart and used up', () => {
    const s = blank();
    const h = addUnit(s, 'knight', 'hero', [5, 5], 'K', undefined, { gear: ['potion'] });
    const g = put(s, 'grunt', 'gob', 6, 5);
    h.hp = 3;
    for (let i = 0; i < 40 && !h.potionUsed; i++) { g.ap = 2; performAttack(s, g, h); }
    expect(h.potionUsed).toBe(true);
    expect(h.potion).toBeUndefined();
    expect(h.hp).toBeGreaterThanOrEqual(2);
  });

  it('a Tower Shield takes 1 off arrows', () => {
    const s = blank();
    const h = addUnit(s, 'archer', 'hero', [5, 5], 'A', undefined, { gear: ['towerShield'] });
    const g = put(s, 'garcher', 'gob', 5, 9);
    expect(hitInfo(s, g, h).dmg).toBe(Math.max(1, CLASSES.garcher.dmg - 1));
  });

  it('chests roll better on harder battles', () => {
    let r = 0;
    const rand = () => (r = (r * 9301 + 49297) % 233280) / 233280;
    const count = (d: 'easy' | 'hard') => {
      let epic = 0;
      for (let i = 0; i < 2000; i++) if (ITEMS[rollChest(d, rand)].rarity === 'epic') epic++;
      return epic;
    };
    expect(count('hard')).toBeGreaterThan(count('easy') * 3);
    // Weapons in chests only fit classes the player has
    for (let i = 0; i < 200; i++) {
      const id = rollChest('hard', rand, ['knight']);
      if (ITEMS[id].slot === 'weapon') expect(ITEMS[id].cls).toBe('knight');
    }
  });
});

describe('Forge and stash', () => {
  it('buy, equip, swap, unequip and sell', () => {
    const c = newCampaign([], fixed);
    c.gold = 100;
    const knight = c.heroes.find(h => h.cls === 'knight')!;
    expect(buy(c, 'ironSword')).toBeNull();
    expect(c.gold).toBe(70);
    expect(buy(c, 'chainmail')).toMatch(/does not sell/);
    expect(equip(c, knight.id, 0)).toBeNull();
    expect(knight.gear?.weapon).toBe('ironSword');
    expect(c.stash).toHaveLength(0);
    // A bow doesn't fit a knight
    c.stash.push('yewBow');
    expect(equip(c, knight.id, 0)).toMatch(/archer/);
    // Swapping puts the old item back in the stash
    c.stash = ['steelSword'];
    equip(c, knight.id, 0);
    expect(knight.gear?.weapon).toBe('steelSword');
    expect(c.stash).toEqual(['ironSword']);
    expect(unequip(c, knight.id, 'weapon')).toBe(true);
    expect(c.stash).toEqual(['ironSword', 'steelSword']);
    const before = c.gold;
    expect(sell(c, 0)).toBe(sellPrice('ironSword'));
    expect(c.gold).toBe(before + 15);
    // Gear goes into battle with the hero
    equip(c, knight.id, 0);
    c.squad = [knight.id];
    const s = createGame({ seed: 4, diff: 'easy', theme: 'village', squad: squadMembers(c), mode: 'campaign' });
    expect(living(s, 'hero')[0].gear).toEqual(['steelSword']);
  });

  it('a win drops a chest; a fallen hero\'s gear comes home after a win and is lost after a defeat', () => {
    for (const won of [true, false]) {
      const c = newCampaign([], fixed);
      c.heroes[1].gear = { armour: 'chainmail' };
      const s = createGame({ seed: 3, diff: 'normal', theme: 'village', squad: squadMembers(c), mode: 'campaign' });
      const b = living(s, 'hero').find(u => u.heroId === c.heroes[1].id)!;
      b.alive = false;
      b.hp = 0;
      if (won) living(s, 'gob').forEach(g => { g.alive = false; });
      else living(s, 'hero').forEach(h => { h.alive = false; });
      s.phase = 'over';
      s.winner = won ? 'hero' : 'gob';
      const r = applyBattle(c, s, fixed)!;
      if (won) {
        expect(r.loot).toBeTruthy();
        expect(r.gearBack).toEqual(['chainmail']);
        expect(c.stash).toContain('chainmail');
        expect(c.stash).toContain(r.loot);
      } else {
        expect(r.loot).toBeUndefined();
        expect(r.gearLost).toEqual(['chainmail']);
        expect(c.stash).toHaveLength(0);
      }
    }
  });

  it('a drunk potion is gone after the battle; a full stash sells the chest', () => {
    const c = newCampaign([], fixed);
    const h = c.heroes[0];
    h.gear = { charm: 'potion' };
    c.stash = Array(LOOT.stashMax).fill('luckyCharm');
    const s = createGame({ seed: 3, diff: 'normal', theme: 'village', squad: squadMembers(c), mode: 'campaign' });
    living(s, 'hero').find(u => u.heroId === h.id)!.potionUsed = true;
    living(s, 'gob').forEach(g => { g.alive = false; });
    s.phase = 'over';
    s.winner = 'hero';
    const gold = c.gold;
    const r = applyBattle(c, s, fixed)!;
    expect(h.gear?.charm).toBeUndefined();
    expect(r.potions).toEqual([h.name]);
    expect(r.lootSold).toBe(sellPrice(r.loot!));
    expect(c.gold).toBe(gold + r.gold + r.lootSold!);
    expect(c.stash).toHaveLength(LOOT.stashMax);
  });
});

describe('goblins that keep up', () => {
  it('a fresh squad meets the normal horde, a strong one meets extra goblins', async () => {
    const { extraGoblins, goblinRoster, squadPower } = await import('../app/src/rules/game');
    const fresh = [{ cls: 'knight' as const, name: 'K' }, { cls: 'archer' as const, name: 'A' }];
    expect(squadPower(fresh)).toBe(0);
    expect(goblinRoster('normal', fresh)).toHaveLength(8);
    const strong = fresh.map(m => ({ ...m, level: 3, path: m.cls === 'knight' ? 'paladin' as const : 'ranger' as const, gear: ['leather' as const] }));
    expect(squadPower(strong)).toBe(2 * (2 + 1 + 1));
    expect(extraGoblins(strong)).toBe(2);
    expect(goblinRoster('normal', strong)).toHaveLength(10);
    const s = createGame({ seed: 5, diff: 'normal', theme: 'village', squad: strong });
    expect(living(s, 'gob')).toHaveLength(10);
  });
});
