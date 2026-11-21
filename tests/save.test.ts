import { describe, expect, it } from 'vitest';
import { SAVE_KEY, defaultSave, loadSave, writeSave } from '../src/core/Save';

class MemStorage {
  data = new Map<string, string>();
  getItem(k: string) {
    return this.data.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.data.set(k, v);
  }
}

describe('save', () => {
  it('returns defaults when empty or corrupt', () => {
    const s = new MemStorage();
    expect(loadSave(s)).toEqual(defaultSave());
    s.setItem(SAVE_KEY, '{not json');
    expect(loadSave(s)).toEqual(defaultSave());
    expect(loadSave(undefined)).toEqual(defaultSave());
  });

  it('round-trips data', () => {
    const s = new MemStorage();
    const d = defaultSave();
    d.credits = 1234;
    d.upgrades.damage = 3;
    d.unlockedShips.push('wraith');
    d.selectedShip = 'wraith';
    writeSave(s, d);
    expect(loadSave(s)).toEqual(d);
  });

  it('sanitises bad values', () => {
    const s = new MemStorage();
    s.setItem(
      SAVE_KEY,
      JSON.stringify({ credits: -5, upgrades: { damage: 99, bogus: 3 }, unlockedShips: ['nope'], selectedShip: 'bastion' }),
    );
    const d = loadSave(s);
    expect(d.credits).toBe(0);
    expect(d.upgrades).toEqual({ damage: 8 });
    expect(d.unlockedShips).toEqual(['falcon']);
    expect(d.selectedShip).toBe('falcon');
  });
});
