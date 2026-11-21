import type { EnemyDef, EnemyKind } from './enemies';
import type { PowerUpId } from './powerups';

export interface Enemy {
  id: number;
  kind: EnemyKind;
  def: EnemyDef;
  x: number;
  z: number;
  vx: number;
  vz: number;
  angle: number;
  spin: number;
  hp: number;
  maxHp: number;
  radius: number;
  scale: number;
  elite: boolean;
  speedMul: number;
  age: number;
  timer: number;
  timer2: number;
  state: number;
  aimX: number;
  aimZ: number;
  flash: number;
  /** 0..1 charge-up glow before attacking. */
  charge: number;
  droneHitT: number;
  /** Shots left in the current burst and the gap timer between them. */
  burst: number;
  burstT: number;
  phase: number;
  seed: number;
  alive: boolean;
}

export interface Bullet {
  x: number;
  z: number;
  vx: number;
  vz: number;
  angle: number;
  life: number;
  damage: number;
  radius: number;
  pierce: number;
  crit: boolean;
  hits: number[];
  hot: boolean;
  drone: boolean;
}

export interface EnemyBullet {
  x: number;
  z: number;
  vx: number;
  vz: number;
  life: number;
  radius: number;
  damage: number;
  big: boolean;
  age: number;
  color: number;
}

export interface Missile {
  x: number;
  z: number;
  vx: number;
  vz: number;
  angle: number;
  speed: number;
  life: number;
  target: Enemy | null;
  damage: number;
}

export interface Pickup {
  kind: 'xp' | 'power';
  x: number;
  z: number;
  vx: number;
  vz: number;
  value: number;
  power: PowerUpId | null;
  life: number;
  age: number;
  magnet: boolean;
  seed: number;
}

export interface PendingSpawn {
  x: number;
  z: number;
  kind: EnemyKind;
  elite: boolean;
  t: number;
  hpMul: number;
  speedMul: number;
}

/** Expanding ring that damages enemies and/or erases enemy bullets as it passes. */
export interface Shockwave {
  x: number;
  z: number;
  r: number;
  speed: number;
  maxR: number;
  damage: number;
  bossDamage: number;
  clearsBullets: boolean;
  hit: Set<number>;
  color: number;
}
