import { describe, expect, it } from 'vitest';
import { addXp, comboMultiplier, creditsForRun, xpToNext } from '../src/game/progression';

describe('progression', () => {
  it('xp curve rises every level', () => {
    for (let l = 1; l < 60; l++) expect(xpToNext(l + 1)).toBeGreaterThan(xpToNext(l));
  });

  it('handles multiple level-ups from one big gain', () => {
    const big = xpToNext(1) + xpToNext(2) + 3;
    expect(addXp(1, 0, big)).toEqual({ level: 3, xp: 3, levelsGained: 2 });
  });

  it('combo multiplier steps by 0.5 every 10 kills and caps at 8', () => {
    expect(comboMultiplier(0)).toBe(1);
    expect(comboMultiplier(9)).toBe(1);
    expect(comboMultiplier(10)).toBe(1.5);
    expect(comboMultiplier(1000)).toBe(8);
  });

  it('credits scale with salvage multiplier', () => {
    expect(creditsForRun(10000, 4, 0, 1)).toBe(300);
    expect(creditsForRun(10000, 4, 0, 1.5)).toBe(450);
  });
});
