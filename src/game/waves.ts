/** Wave director: builds a schedule of spawn groups for a given wave number. */
import { mathRandom, weightedPick, type Rand } from '../core/math';
import { ENEMIES, SPAWNABLE, type EnemyKind } from './enemies';

export type Formation = 'scatter' | 'cluster' | 'ring' | 'line';

export interface SpawnGroup {
  at: number;
  kind: EnemyKind;
  count: number;
  formation: Formation;
  elite: boolean;
}

export interface WavePlan {
  wave: number;
  boss: boolean;
  duration: number;
  hpMul: number;
  speedMul: number;
  groups: SpawnGroup[];
}

export const BOSS_EVERY = 5;
export const isBossWave = (n: number): boolean => n > 0 && n % BOSS_EVERY === 0;

export const waveBudget = (n: number): number => Math.round(10 + n * 5 + Math.pow(n, 1.35));
export const waveHpMul = (n: number): number => 1 + 0.14 * (n - 1) + 0.004 * (n - 1) * (n - 1);
export const waveSpeedMul = (n: number): number => Math.min(1.45, 1 + 0.02 * (n - 1));
export const bossHp = (n: number): number => {
  const k = Math.max(1, Math.round(n / BOSS_EVERY));
  return Math.round(ENEMIES.boss.hp * (1 + 0.85 * (k - 1)));
};

function formationFor(kind: EnemyKind, n: number, rng: Rand): Formation {
  const r = rng.next();
  switch (kind) {
    case 'darter':
      return n >= 3 && r < 0.25 ? 'ring' : r < 0.6 ? 'cluster' : 'scatter';
    case 'mite':
      return n >= 4 && r < 0.3 ? 'ring' : 'cluster';
    case 'lancer':
    case 'ram':
      return r < 0.45 ? 'line' : 'scatter';
    default:
      return 'scatter';
  }
}

export function buildWave(n: number, rng: Rand = mathRandom): WavePlan {
  const hpMul = waveHpMul(n);
  const speedMul = waveSpeedMul(n);

  if (isBossWave(n)) {
    const escorts: SpawnGroup[] = [];
    const escortKinds: EnemyKind[] = n >= 10 ? ['darter', 'lancer', 'mite', 'ram'] : ['darter', 'mite'];
    for (let i = 0; i < 3 + Math.floor(n / 5); i++) {
      const kind = escortKinds[i % escortKinds.length];
      const def = ENEMIES[kind];
      escorts.push({ at: 10 + i * 9, kind, count: def.group[0], formation: kind === 'mite' ? 'ring' : 'scatter', elite: false });
    }
    return {
      wave: n,
      boss: true,
      duration: 999,
      hpMul,
      speedMul,
      groups: [{ at: 2.5, kind: 'boss', count: 1, formation: 'scatter', elite: false }, ...escorts],
    };
  }

  const available = SPAWNABLE.filter((k) => ENEMIES[k].minWave <= n);
  let budget = waveBudget(n);
  const groups: SpawnGroup[] = [];
  const eliteChance = Math.min(0.3, 0.03 * n);

  // Always open with something readable.
  const opener = ENEMIES.darter;
  const openCount = Math.min(opener.group[1] + Math.floor(n / 3), 3 + n);
  groups.push({ at: 0.5, kind: 'darter', count: openCount, formation: 'cluster', elite: false });
  budget -= openCount * opener.cost;

  let guard = 0;
  while (budget > 0 && guard++ < 60) {
    const def = weightedPick(available, (k) => ENEMIES[k].weight, rng);
    if (!def) break;
    const d = ENEMIES[def];
    const extra = Math.floor(n / (d.cost >= 3 ? 6 : 3));
    const count = Math.max(1, Math.round(d.group[0] + rng.next() * (d.group[1] - d.group[0])) + extra);
    groups.push({
      at: 0,
      kind: def,
      count,
      formation: formationFor(def, n, rng),
      elite: n >= 2 && rng.next() < eliteChance,
    });
    budget -= count * d.cost;
  }

  const duration = Math.min(34, 16 + n * 1.3);
  const rest = groups.length - 1;
  for (let i = 1; i < groups.length; i++) {
    const base = 2 + ((i - 1) / Math.max(1, rest)) * (duration - 2);
    groups[i].at = Math.round((base + rng.next() * 1.5) * 100) / 100;
  }
  groups.sort((a, b) => a.at - b.at);

  return { wave: n, boss: false, duration, hpMul, speedMul, groups };
}
