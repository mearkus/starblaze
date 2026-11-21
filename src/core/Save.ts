/** Persistent progress stored in localStorage. Tolerates missing or corrupt data. */
import type { ShipId } from '../game/ships';
import { SHIPS } from '../game/ships';
import { UPGRADES, type UpgradeLevels } from '../game/upgrades';

export interface Settings {
  music: boolean;
  sfx: boolean;
  shake: boolean;
  volume: number;
}

export interface SaveData {
  version: 1;
  credits: number;
  highScore: number;
  bestWave: number;
  totalKills: number;
  runs: number;
  upgrades: UpgradeLevels;
  unlockedShips: ShipId[];
  selectedShip: ShipId;
  settings: Settings;
}

export const SAVE_KEY = 'starblaze.save.v1';

export function defaultSave(): SaveData {
  return {
    version: 1,
    credits: 0,
    highScore: 0,
    bestWave: 0,
    totalKills: 0,
    runs: 0,
    upgrades: {},
    unlockedShips: ['falcon'],
    selectedShip: 'falcon',
    settings: { music: true, sfx: true, shake: true, volume: 0.7 },
  };
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

const num = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : fallback;

export function loadSave(storage: StorageLike | undefined): SaveData {
  const base = defaultSave();
  if (!storage) return base;
  let raw: unknown;
  try {
    const text = storage.getItem(SAVE_KEY);
    if (!text) return base;
    raw = JSON.parse(text);
  } catch {
    return base;
  }
  if (!raw || typeof raw !== 'object') return base;
  const r = raw as Partial<SaveData>;

  const upgrades: UpgradeLevels = {};
  if (r.upgrades && typeof r.upgrades === 'object') {
    for (const def of UPGRADES) {
      const lvl = (r.upgrades as Record<string, unknown>)[def.id];
      if (typeof lvl === 'number' && lvl > 0) upgrades[def.id] = Math.min(def.maxLevel, Math.floor(lvl));
    }
  }
  const unlocked = Array.isArray(r.unlockedShips)
    ? r.unlockedShips.filter((s): s is ShipId => typeof s === 'string' && s in SHIPS)
    : [];
  if (!unlocked.includes('falcon')) unlocked.unshift('falcon');
  const selected = r.selectedShip && unlocked.includes(r.selectedShip) ? r.selectedShip : 'falcon';
  const s = (r.settings ?? {}) as Partial<Settings>;

  return {
    version: 1,
    credits: Math.floor(num(r.credits, 0)),
    highScore: Math.floor(num(r.highScore, 0)),
    bestWave: Math.floor(num(r.bestWave, 0)),
    totalKills: Math.floor(num(r.totalKills, 0)),
    runs: Math.floor(num(r.runs, 0)),
    upgrades,
    unlockedShips: unlocked,
    selectedShip: selected,
    settings: {
      music: typeof s.music === 'boolean' ? s.music : base.settings.music,
      sfx: typeof s.sfx === 'boolean' ? s.sfx : base.settings.sfx,
      shake: typeof s.shake === 'boolean' ? s.shake : base.settings.shake,
      volume: typeof s.volume === 'number' ? Math.min(1, Math.max(0, s.volume)) : base.settings.volume,
    },
  };
}

export function writeSave(storage: StorageLike | undefined, data: SaveData): void {
  if (!storage) return;
  try {
    storage.setItem(SAVE_KEY, JSON.stringify(data));
  } catch {
    // Storage full or blocked (private mode) — progress just won't persist.
  }
}
