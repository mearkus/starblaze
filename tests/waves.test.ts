import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/math';
import { ENEMIES } from '../src/game/enemies';
import { bossHp, buildWave, isBossWave, waveBudget } from '../src/game/waves';

describe('buildWave', () => {
  it('only uses unlocked enemy types', () => {
    for (let n = 1; n <= 30; n++) {
      if (isBossWave(n)) continue;
      const plan = buildWave(n, new Rng(n));
      for (const g of plan.groups) expect(ENEMIES[g.kind].minWave).toBeLessThanOrEqual(n);
    }
  });

  it('schedules groups in order within the wave duration', () => {
    const plan = buildWave(8, new Rng(3));
    for (let i = 1; i < plan.groups.length; i++) expect(plan.groups[i].at).toBeGreaterThanOrEqual(plan.groups[i - 1].at);
    expect(plan.groups[plan.groups.length - 1].at).toBeLessThanOrEqual(plan.duration + 2);
  });

  it('gets harder over time', () => {
    expect(waveBudget(10)).toBeGreaterThan(waveBudget(2));
    expect(buildWave(12, new Rng(1)).hpMul).toBeGreaterThan(buildWave(2, new Rng(1)).hpMul);
  });

  it('every fifth wave is a boss wave', () => {
    expect(isBossWave(5)).toBe(true);
    expect(isBossWave(6)).toBe(false);
    const plan = buildWave(5, new Rng(1));
    expect(plan.boss).toBe(true);
    expect(plan.groups[0].kind).toBe('boss');
    expect(bossHp(10)).toBeGreaterThan(bossHp(5));
  });
});
