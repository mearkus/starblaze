import { describe, expect, it } from 'vitest';
import { SpatialHash } from '../src/core/SpatialHash';

describe('SpatialHash', () => {
  it('finds nearby items and skips far ones', () => {
    const h = new SpatialHash<string>(8);
    h.insert('a', 0, 0, 1);
    h.insert('b', 50, 50, 1);
    h.insert('c', -3, 2, 2);
    const found = new Set<string>();
    h.query(0, 0, 4, (it) => {
      found.add(it);
    });
    expect(found.has('a')).toBe(true);
    expect(found.has('c')).toBe(true);
    expect(found.has('b')).toBe(false);
  });

  it('clear() empties the grid', () => {
    const h = new SpatialHash<number>(4);
    h.insert(1, 0, 0, 1);
    h.clear();
    let n = 0;
    h.query(0, 0, 10, () => {
      n++;
    });
    expect(n).toBe(0);
  });
});
