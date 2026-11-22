/** Combines ship, hangar upgrades and run perks into the final numbers gameplay uses. */
import { SHIPS, type ShipId } from './ships';
import type { UpgradeLevels } from './upgrades';
import { tierOf, type PerkTiers } from './perks';

export interface PlayerStats {
  maxHull: number;
  maxShield: number;
  shieldRegen: number;
  shieldDelay: number;
  speed: number;
  accel: number;
  /** Overall damage multiplier (applies to every weapon). */
  damageMul: number;
  /** Damage of one cannon bolt. */
  damage: number;
  fireInterval: number;
  projectiles: number;
  spread: number;
  bulletSpeed: number;
  bulletSize: number;
  pierce: number;
  critChance: number;
  critMul: number;
  magnetRange: number;
  xpMul: number;
  creditMul: number;
  dashCooldown: number;
  startBombs: number;
  bombDamage: number;
  missiles: number;
  missileInterval: number;
  missileDamage: number;
  drones: number;
  droneDamage: number;
  chainChance: number;
  chainTargets: number;
  chainDamage: number;
  novaInterval: number;
  novaRadius: number;
  novaDamage: number;
  rearGuns: number;
  killHeal: number;
}

export const BASE = {
  damage: 10,
  fireInterval: 0.13,
  bulletSpeed: 115,
  magnet: 12,
  crit: 0.05,
  critMul: 2.5,
};

/** Sustained main-cannon damage per second, including average crit bonus. */
export function cannonDps(s: PlayerStats): number {
  return ((s.projectiles * s.damage) / s.fireInterval) * (1 + s.critChance * (s.critMul - 1));
}

export function computeStats(shipId: ShipId, up: UpgradeLevels, perks: PerkTiers): PlayerStats {
  const ship = SHIPS[shipId];
  const u = (id: keyof UpgradeLevels) => up[id] ?? 0;
  const t = (id: Parameters<typeof tierOf>[1]) => tierOf(perks, id);

  const damageMul =
    ship.damageMul * (1 + 0.1 * u('damage')) * (1 + 0.18 * t('power')) * (1 + 0.08 * t('velocity'));
  const fireRateMul = ship.fireRateMul * (1 + 0.07 * u('fireRate')) * (1 + 0.15 * t('rapid'));
  const projectiles = ship.projectiles + u('multishot') + t('spread');

  const maxShield = ship.shield + 15 * u('shield') + 20 * t('aegis');
  const missiles = t('missiles') > 0 ? 1 + t('missiles') : 0;

  return {
    maxHull: Math.round(ship.hull * (1 + 0.12 * u('hull')) + 25 * t('nanoplate')),
    maxShield,
    shieldRegen: maxShield * (0.22 + 0.04 * u('shield') + 0.06 * t('aegis')),
    shieldDelay: Math.max(0.8, 2.6 - 0.2 * u('shield') - 0.3 * t('aegis')),
    speed: ship.speed * (1 + 0.05 * u('thrusters')) * (1 + 0.1 * t('engines')),
    accel: 9,
    damageMul,
    damage: BASE.damage * damageMul,
    fireInterval: BASE.fireInterval / fireRateMul,
    projectiles,
    spread: projectiles > 3 ? 0.11 : 0.085,
    bulletSpeed: BASE.bulletSpeed * (1 + 0.2 * t('velocity')),
    bulletSize: 1 + 0.12 * t('velocity'),
    pierce: t('pierce'),
    critChance: Math.min(0.75, BASE.crit + 0.04 * u('crit') + 0.1 * t('crit')),
    critMul: BASE.critMul,
    magnetRange: BASE.magnet * (1 + 0.2 * u('magnet')) * (1 + 0.4 * t('tractor')),
    xpMul: 1 + 0.1 * t('tractor'),
    creditMul: 1 + 0.12 * u('salvage'),
    dashCooldown: ship.dashCooldown * (1 - 0.06 * u('thrusters')) * (1 - 0.15 * t('engines')),
    startBombs: 1 + u('bombs'),
    bombDamage: 120 * damageMul * (1 + 0.5 * t('ordnance')),
    missiles,
    missileInterval: Math.max(0.9, 2.4 - 0.25 * t('missiles')),
    missileDamage: 26 * damageMul,
    drones: ship.startDrones + t('drones'),
    droneDamage: 14 * damageMul,
    chainChance: Math.min(0.6, 0.14 * t('chain')),
    chainTargets: 2 + t('chain'),
    chainDamage: 9 * damageMul,
    novaInterval: Math.max(1.8, 4.6 - 0.6 * t('nova')),
    novaRadius: 15 + 3 * t('nova'),
    novaDamage: (25 + 15 * t('nova')) * damageMul,
    rearGuns: t('rear'),
    killHeal: 0.5 * t('nanites'),
  };
}
