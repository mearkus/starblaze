/** In-run level-up perks. Pick one of three every time the ship levels up. */
import { mathRandom, weightedPick, type Rand } from '../core/math';

export type PerkId =
  | 'power'
  | 'rapid'
  | 'spread'
  | 'pierce'
  | 'velocity'
  | 'missiles'
  | 'drones'
  | 'chain'
  | 'nova'
  | 'rear'
  | 'nanoplate'
  | 'aegis'
  | 'engines'
  | 'tractor'
  | 'crit'
  | 'ordnance'
  | 'nanites';

export type FallbackId = 'field_repair' | 'score_cache';
export type ChoiceId = PerkId | FallbackId;

export type PerkKind = 'weapon' | 'system' | 'defense';

export interface PerkDef {
  id: ChoiceId;
  name: string;
  desc: string;
  icon: string;
  kind: PerkKind;
  maxTier: number;
  weight: number;
}

export const PERKS: PerkDef[] = [
  { id: 'power', name: 'Plasma Core', desc: '+18% damage', icon: '✸', kind: 'weapon', maxTier: 5, weight: 1 },
  { id: 'rapid', name: 'Hyper Cycler', desc: '+15% fire rate', icon: '≫', kind: 'weapon', maxTier: 5, weight: 1 },
  { id: 'spread', name: 'Split Barrel', desc: '+1 projectile per volley', icon: '⋔', kind: 'weapon', maxTier: 4, weight: 0.9 },
  { id: 'pierce', name: 'Phase Rounds', desc: 'Shots pierce +1 enemy', icon: '⇶', kind: 'weapon', maxTier: 3, weight: 0.8 },
  { id: 'velocity', name: 'Rail Accelerator', desc: '+20% shot speed, +8% damage, bigger bolts', icon: '➶', kind: 'weapon', maxTier: 3, weight: 0.8 },
  { id: 'missiles', name: 'Swarm Missiles', desc: 'Auto-fire homing missiles. More per salvo each tier', icon: '⟁', kind: 'weapon', maxTier: 5, weight: 1 },
  { id: 'drones', name: 'Orbital Drones', desc: '+1 drone that orbits, rams and shoots', icon: '◉', kind: 'weapon', maxTier: 4, weight: 1 },
  { id: 'chain', name: 'Arc Coil', desc: 'Hits can chain lightning to nearby enemies', icon: 'ϟ', kind: 'weapon', maxTier: 4, weight: 1 },
  { id: 'nova', name: 'Nova Pulse', desc: 'Periodic shockwave blasts enemies around you', icon: '✺', kind: 'weapon', maxTier: 4, weight: 1 },
  { id: 'rear', name: 'Tail Gunner', desc: 'Adds rear-facing cannons', icon: '⇄', kind: 'weapon', maxTier: 2, weight: 0.7 },
  { id: 'nanoplate', name: 'Nanoplating', desc: '+25 max hull and full repair', icon: '⬢', kind: 'defense', maxTier: 5, weight: 0.9 },
  { id: 'aegis', name: 'Aegis Matrix', desc: '+20 shield, faster recharge', icon: '◈', kind: 'defense', maxTier: 4, weight: 0.9 },
  { id: 'engines', name: 'Afterburners', desc: '+10% speed, faster dash', icon: '➤', kind: 'system', maxTier: 3, weight: 0.8 },
  { id: 'tractor', name: 'Tractor Field', desc: '+40% pickup range, +10% XP', icon: '◎', kind: 'system', maxTier: 3, weight: 0.8 },
  { id: 'crit', name: 'Targeting AI', desc: '+10% critical hit chance', icon: '⌖', kind: 'weapon', maxTier: 4, weight: 0.9 },
  { id: 'ordnance', name: 'Ordnance Cache', desc: '+1 nova bomb now, bombs hit 50% harder', icon: '✹', kind: 'system', maxTier: 3, weight: 0.7 },
  { id: 'nanites', name: 'Salvage Nanites', desc: 'Kills repair your hull', icon: '✚', kind: 'defense', maxTier: 3, weight: 0.7 },
];

export const FALLBACKS: PerkDef[] = [
  { id: 'field_repair', name: 'Field Repair', desc: 'Restore 40% hull', icon: '✚', kind: 'defense', maxTier: Infinity, weight: 1 },
  { id: 'score_cache', name: 'Data Cache', desc: '+2,500 score per wave reached', icon: '★', kind: 'system', maxTier: Infinity, weight: 1 },
];

export const PERK_BY_ID: Record<ChoiceId, PerkDef> = Object.fromEntries(
  [...PERKS, ...FALLBACKS].map((p) => [p.id, p]),
) as Record<ChoiceId, PerkDef>;

export type PerkTiers = Partial<Record<PerkId, number>>;

export const tierOf = (tiers: PerkTiers, id: PerkId): number => tiers[id] ?? 0;

/**
 * Roll `count` distinct perk choices. Maxed perks are excluded. Perks you already own are
 * slightly favoured so builds can snowball. Fallbacks fill any empty slots.
 */
export function rollPerks(tiers: PerkTiers, count = 3, rng: Rand = mathRandom): ChoiceId[] {
  const pool = PERKS.filter((p) => tierOf(tiers, p.id as PerkId) < p.maxTier);
  const out: ChoiceId[] = [];
  while (out.length < count && pool.length > 0) {
    const p = weightedPick(pool, (d) => d.weight * (tierOf(tiers, d.id as PerkId) > 0 ? 1.35 : 1), rng);
    if (!p) break;
    out.push(p.id);
    pool.splice(pool.indexOf(p), 1);
  }
  for (const f of FALLBACKS) {
    if (out.length >= count) break;
    out.push(f.id);
  }
  return out;
}
