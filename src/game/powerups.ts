/** Temporary power-ups dropped by enemies. */
export type PowerUpId = 'overdrive' | 'spread' | 'shield' | 'repair' | 'bomb' | 'magnet' | 'multiplier' | 'timewarp';

export interface PowerUpDef {
  id: PowerUpId;
  name: string;
  desc: string;
  /** Seconds the effect lasts; 0 = instant. */
  duration: number;
  color: number;
  weight: number;
}

export const POWERUPS: PowerUpDef[] = [
  { id: 'overdrive', name: 'OVERDRIVE', desc: 'Double fire rate, hotter bolts', duration: 9, color: 0xff5a1f, weight: 1.2 },
  { id: 'spread', name: 'SPREAD SHOT', desc: '+3 projectiles, wide arc', duration: 10, color: 0x39ff6a, weight: 1.2 },
  { id: 'multiplier', name: 'SCORE x2', desc: 'Double score', duration: 12, color: 0xffe14a, weight: 0.9 },
  { id: 'timewarp', name: 'TIME WARP', desc: 'Enemies slow to a crawl', duration: 6, color: 0x9b7bff, weight: 0.7 },
  { id: 'shield', name: 'SHIELD BURST', desc: 'Full shield + brief invulnerability', duration: 0, color: 0x3ad7ff, weight: 1 },
  { id: 'repair', name: 'REPAIR', desc: 'Restore 35% hull', duration: 0, color: 0xff3d6e, weight: 1 },
  { id: 'bomb', name: '+1 BOMB', desc: 'Extra nova bomb', duration: 0, color: 0xffffff, weight: 0.6 },
  { id: 'magnet', name: 'MAGNET', desc: 'Pull in all XP', duration: 0, color: 0x46ffe0, weight: 0.8 },
];

export const POWERUP_BY_ID: Record<PowerUpId, PowerUpDef> = Object.fromEntries(
  POWERUPS.map((p) => [p.id, p]),
) as Record<PowerUpId, PowerUpDef>;
