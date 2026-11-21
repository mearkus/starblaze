/** Permanent hangar upgrades bought with credits between runs. */

export type UpgradeId =
  | 'hull'
  | 'shield'
  | 'damage'
  | 'fireRate'
  | 'thrusters'
  | 'magnet'
  | 'crit'
  | 'bombs'
  | 'multishot'
  | 'salvage';

export interface UpgradeDef {
  id: UpgradeId;
  name: string;
  desc: string;
  icon: string;
  maxLevel: number;
  baseCost: number;
  growth: number;
}

export const UPGRADES: UpgradeDef[] = [
  { id: 'damage', name: 'Plasma Amplifier', desc: '+10% weapon damage', icon: '✸', maxLevel: 8, baseCost: 150, growth: 1.5 },
  { id: 'fireRate', name: 'Cycler Coils', desc: '+7% fire rate', icon: '≫', maxLevel: 8, baseCost: 150, growth: 1.5 },
  { id: 'hull', name: 'Hull Plating', desc: '+12% max hull', icon: '⬢', maxLevel: 6, baseCost: 120, growth: 1.55 },
  { id: 'shield', name: 'Shield Capacitor', desc: '+15 shield, faster recharge', icon: '◈', maxLevel: 5, baseCost: 150, growth: 1.6 },
  { id: 'thrusters', name: 'Ion Thrusters', desc: '+5% speed, faster dash', icon: '➤', maxLevel: 5, baseCost: 120, growth: 1.55 },
  { id: 'magnet', name: 'Tractor Beam', desc: '+20% pickup range', icon: '◎', maxLevel: 5, baseCost: 100, growth: 1.5 },
  { id: 'crit', name: 'Targeting Array', desc: '+4% critical hit chance', icon: '⌖', maxLevel: 5, baseCost: 180, growth: 1.55 },
  { id: 'bombs', name: 'Bomb Bay', desc: '+1 starting nova bomb', icon: '✺', maxLevel: 3, baseCost: 300, growth: 1.8 },
  { id: 'salvage', name: 'Salvage Drones', desc: '+12% credits earned', icon: '¤', maxLevel: 5, baseCost: 200, growth: 1.6 },
  { id: 'multishot', name: 'Extra Cannon', desc: '+1 projectile per volley', icon: '⋔', maxLevel: 2, baseCost: 1200, growth: 2.5 },
];

export const UPGRADE_BY_ID: Record<UpgradeId, UpgradeDef> = Object.fromEntries(
  UPGRADES.map((u) => [u.id, u]),
) as Record<UpgradeId, UpgradeDef>;

export type UpgradeLevels = Partial<Record<UpgradeId, number>>;

/** Cost to buy the next level when currently at `level`. Rounded to a multiple of 5. */
export function upgradeCost(def: UpgradeDef, level: number): number {
  return Math.round((def.baseCost * Math.pow(def.growth, level)) / 5) * 5;
}

export function canBuy(def: UpgradeDef, level: number, credits: number): boolean {
  return level < def.maxLevel && credits >= upgradeCost(def, level);
}
