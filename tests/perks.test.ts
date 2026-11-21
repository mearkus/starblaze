import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/math';
import { PERKS, rollPerks, type PerkId, type PerkTiers } from '../src/game/perks';

describe('rollPerks', () => {
  it('returns three distinct choices', () => {
    const rng = new Rng(42);
    for (let i = 0; i < 200; i++) {
      const picks = rollPerks({}, 3, rng);
      expect(picks).toHaveLength(3);
      expect(new Set(picks).size).toBe(3);
    }
  });

  it('never offers a maxed perk', () => {
    const tiers: PerkTiers = { power: 5, rapid: 5, spread: 4 };
    const rng = new Rng(7);
    for (let i = 0; i < 300; i++) {
      const picks = rollPerks(tiers, 3, rng);
      expect(picks).not.toContain('power');
      expect(picks).not.toContain('rapid');
      expect(picks).not.toContain('spread');
    }
  });

  it('fills with fallbacks when everything is maxed', () => {
    const tiers: PerkTiers = {};
    for (const p of PERKS) tiers[p.id as PerkId] = p.maxTier;
    expect(rollPerks(tiers, 3, new Rng(1))).toEqual(['field_repair', 'score_cache']);
    const almost: PerkTiers = { ...tiers, crit: 0 };
    expect(rollPerks(almost, 3, new Rng(1))).toEqual(['crit', 'field_repair', 'score_cache']);
  });
});
