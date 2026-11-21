export type ShipId = 'falcon' | 'wraith' | 'bastion';

export interface ShipDef {
  id: ShipId;
  name: string;
  tagline: string;
  cost: number;
  hull: number;
  shield: number;
  speed: number;
  damageMul: number;
  fireRateMul: number;
  projectiles: number;
  dashCooldown: number;
  startDrones: number;
  /** Primary hull glow colour. */
  color: number;
  /** Secondary accent colour (engines, stripes). */
  accent: number;
}

export const SHIPS: Record<ShipId, ShipDef> = {
  falcon: {
    id: 'falcon',
    name: 'Falcon',
    tagline: 'Balanced interceptor. Twin plasma cannons.',
    cost: 0,
    hull: 100,
    shield: 30,
    speed: 36,
    damageMul: 1,
    fireRateMul: 1,
    projectiles: 2,
    dashCooldown: 2.0,
    startDrones: 0,
    color: 0x35d4ff,
    accent: 0xff3df2,
  },
  wraith: {
    id: 'wraith',
    name: 'Wraith',
    tagline: 'Glass-cannon striker. Blistering speed and fire rate.',
    cost: 3500,
    hull: 75,
    shield: 40,
    speed: 44,
    damageMul: 0.9,
    fireRateMul: 1.35,
    projectiles: 2,
    dashCooldown: 1.3,
    startDrones: 0,
    color: 0xb34dff,
    accent: 0x3dffc8,
  },
  bastion: {
    id: 'bastion',
    name: 'Bastion',
    tagline: 'Heavy gunship. Triple cannons and an escort drone.',
    cost: 7000,
    hull: 150,
    shield: 30,
    speed: 30,
    damageMul: 1.4,
    fireRateMul: 0.9,
    projectiles: 3,
    dashCooldown: 2.6,
    startDrones: 1,
    color: 0xffa21a,
    accent: 0xff2a55,
  },
};

export const SHIP_ORDER: ShipId[] = ['falcon', 'wraith', 'bastion'];
