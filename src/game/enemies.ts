/** Enemy archetypes. Behaviour lives in ai.ts; these are the tunable numbers. */
export type EnemyKind = 'darter' | 'mite' | 'lancer' | 'orbiter' | 'ram' | 'bulwark' | 'boss';

export interface EnemyDef {
  kind: EnemyKind;
  name: string;
  hp: number;
  speed: number;
  radius: number;
  score: number;
  xp: number;
  contact: number;
  /** Glow colour used for trim, explosions and spawn portals. */
  color: number;
  /** Spawn budget cost per unit. */
  cost: number;
  minWave: number;
  weight: number;
  group: [number, number];
  /** Base chance to drop a power-up. */
  dropChance: number;
}

export const ENEMIES: Record<EnemyKind, EnemyDef> = {
  darter: { kind: 'darter', name: 'Darter', hp: 20, speed: 17, radius: 1.7, score: 100, xp: 1, contact: 14, color: 0xff4a2a, cost: 1, minWave: 1, weight: 1.2, group: [4, 7], dropChance: 0.02 },
  mite: { kind: 'mite', name: 'Mite', hp: 7, speed: 23, radius: 1.05, score: 40, xp: 1, contact: 8, color: 0xffcc22, cost: 0.45, minWave: 2, weight: 0.8, group: [8, 14], dropChance: 0.01 },
  lancer: { kind: 'lancer', name: 'Lancer', hp: 45, speed: 14, radius: 2.05, score: 250, xp: 3, contact: 14, color: 0x7dff3a, cost: 3, minWave: 3, weight: 1, group: [2, 4], dropChance: 0.04 },
  orbiter: { kind: 'orbiter', name: 'Orbiter', hp: 70, speed: 8, radius: 2.65, score: 300, xp: 4, contact: 16, color: 0xff2ad4, cost: 3.5, minWave: 4, weight: 0.8, group: [1, 3], dropChance: 0.05 },
  ram: { kind: 'ram', name: 'Ram', hp: 60, speed: 12, radius: 2.3, score: 300, xp: 4, contact: 26, color: 0xff8a1a, cost: 3, minWave: 5, weight: 0.9, group: [2, 4], dropChance: 0.05 },
  bulwark: { kind: 'bulwark', name: 'Bulwark', hp: 280, speed: 6, radius: 3.9, score: 800, xp: 10, contact: 30, color: 0x9d6bff, cost: 7, minWave: 6, weight: 0.6, group: [1, 2], dropChance: 0.18 },
  boss: { kind: 'boss', name: 'Dreadnought', hp: 4500, speed: 9, radius: 7.5, score: 25000, xp: 80, contact: 40, color: 0xff2a4a, cost: 0, minWave: 5, weight: 0, group: [1, 1], dropChance: 1 },
};

export const SPAWNABLE: EnemyKind[] = ['darter', 'mite', 'lancer', 'orbiter', 'ram', 'bulwark'];
