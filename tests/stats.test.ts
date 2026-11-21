import { describe, expect, it } from 'vitest';
import { computeStats } from '../src/game/stats';
import { SHIPS } from '../src/game/ships';
import { UPGRADES, canBuy, upgradeCost } from '../src/game/upgrades';

describe('computeStats', () => {
  it('uses ship base values with no upgrades', () => {
    const s = computeStats('falcon', {}, {});
    expect(s.maxHull).toBe(SHIPS.falcon.hull);
    expect(s.projectiles).toBe(2);
    expect(s.missiles).toBe(0);
    expect(s.drones).toBe(0);
    expect(s.startBombs).toBe(1);
  });

  it('upgrades and perks stack', () => {
    const base = computeStats('falcon', {}, {});
    const s = computeStats('falcon', { damage: 2, multishot: 1, bombs: 2 }, { power: 1, spread: 2, missiles: 1, drones: 2 });
    expect(s.damage).toBeCloseTo(base.damage * 1.2 * 1.18);
    expect(s.projectiles).toBe(5);
    expect(s.startBombs).toBe(3);
    expect(s.missiles).toBe(2);
    expect(s.drones).toBe(2);
  });

  it('bastion starts with a drone and three cannons', () => {
    const s = computeStats('bastion', {}, {});
    expect(s.drones).toBe(1);
    expect(s.projectiles).toBe(3);
  });

  it('fire interval shrinks with fire-rate upgrades', () => {
    expect(computeStats('falcon', { fireRate: 4 }, { rapid: 2 }).fireInterval).toBeLessThan(
      computeStats('falcon', {}, {}).fireInterval,
    );
  });
});

describe('upgrade costs', () => {
  it('costs grow per level and are multiples of 5', () => {
    for (const def of UPGRADES) {
      let prev = 0;
      for (let l = 0; l < def.maxLevel; l++) {
        const c = upgradeCost(def, l);
        expect(c % 5).toBe(0);
        expect(c).toBeGreaterThan(prev);
        prev = c;
      }
    }
  });

  it('cannot buy past max level or without credits', () => {
    const def = UPGRADES[0];
    expect(canBuy(def, def.maxLevel, 1e9)).toBe(false);
    expect(canBuy(def, 0, upgradeCost(def, 0) - 1)).toBe(false);
    expect(canBuy(def, 0, upgradeCost(def, 0))).toBe(true);
  });
});
