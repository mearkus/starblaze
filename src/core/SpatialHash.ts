/**
 * Uniform grid for broad-phase collision queries on the XZ plane.
 * Rebuilt every frame: clear() then insert() each item, then query().
 */
export class SpatialHash<T> {
  private cells = new Map<number, T[]>();
  private pool: T[][] = [];
  private readonly inv: number;

  constructor(readonly cellSize: number) {
    this.inv = 1 / cellSize;
  }

  private key(cx: number, cz: number): number {
    // Offset keeps keys positive for arenas up to ~±16k cells.
    return (cx + 16384) * 32768 + (cz + 16384);
  }

  clear(): void {
    for (const arr of this.cells.values()) {
      arr.length = 0;
      this.pool.push(arr);
    }
    this.cells.clear();
  }

  insert(item: T, x: number, z: number, radius: number): void {
    const x0 = Math.floor((x - radius) * this.inv);
    const x1 = Math.floor((x + radius) * this.inv);
    const z0 = Math.floor((z - radius) * this.inv);
    const z1 = Math.floor((z + radius) * this.inv);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        const k = this.key(cx, cz);
        let arr = this.cells.get(k);
        if (!arr) {
          arr = this.pool.pop() ?? [];
          this.cells.set(k, arr);
        }
        arr.push(item);
      }
    }
  }

  /** Calls `fn` for every item whose cell overlaps the query circle. Items may repeat; dedupe if needed. */
  query(x: number, z: number, radius: number, fn: (item: T) => boolean | void): void {
    const x0 = Math.floor((x - radius) * this.inv);
    const x1 = Math.floor((x + radius) * this.inv);
    const z0 = Math.floor((z - radius) * this.inv);
    const z1 = Math.floor((z + radius) * this.inv);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        const arr = this.cells.get(this.key(cx, cz));
        if (!arr) continue;
        for (let i = 0; i < arr.length; i++) {
          if (fn(arr[i]) === true) return;
        }
      }
    }
  }
}
