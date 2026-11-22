import { describe, expect, it } from 'vitest';
import { cannonDps, computeStats } from '../src/game/stats';
import { bossHp } from '../src/game/waves';

// Seconds of sustained main-cannon fire needed to destroy a boss.
const timeToKill = (wave: number, perks: Parameters<typeof computeStats>[2]) =>
  bossHp(wave) / cannonDps(computeStats('falcon', {}, perks));

describe('boss balance', () => {
  it('first boss is beatable by a starting Falcon with no upgrades or power-ups', () => {
    // Bare ship: a long but fair fight.
    const bare = timeToKill(5, {});
    expect(bare).toBeGreaterThan(12);
    expect(bare).toBeLessThan(20);
  });

  it('typical wave-5 perks bring the first boss into the 8–16 s range', () => {
    const t = timeToKill(5, { power: 1, rapid: 1 });
    expect(t).toBeGreaterThan(8);
    expect(t).toBeLessThan(16);
  });

  it('later bosses get tougher', () => {
    expect(bossHp(10)).toBeGreaterThan(bossHp(5));
    expect(bossHp(15)).toBeGreaterThan(bossHp(10));
  });
});
