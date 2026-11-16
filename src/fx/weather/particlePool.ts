/** Fixed-capacity object pool to avoid GC churn in weather sims. */

export interface PoolSlot {
  alive: boolean;
}

export interface ParticlePool<T extends PoolSlot> {
  readonly capacity: number;
  readonly items: T[];
  acquire: () => T | null;
  release: (item: T) => void;
  clear: () => void;
  forEachAlive: (fn: (item: T, index: number) => void) => void;
  aliveCount: () => number;
}

export function createPool<T extends PoolSlot>(
  capacity: number,
  factory: () => T,
): ParticlePool<T> {
  const items = Array.from({ length: capacity }, () => factory());
  const indices = new Map(items.map((item, index) => [item, index]));
  const free = new Uint32Array(capacity);
  const leased = new Uint8Array(capacity);
  let freeCount = capacity;
  for (let i = 0; i < capacity; i++) {
    items[i]!.alive = false;
    free[i] = capacity - i - 1;
  }

  return {
    capacity,
    items,
    acquire() {
      if (freeCount === 0) return null;
      const index = free[--freeCount]!;
      const item = items[index]!;
      leased[index] = 1;
      item.alive = true;
      return item;
    },
    release(item) {
      const index = indices.get(item);
      if (index === undefined || leased[index] === 0) return;
      leased[index] = 0;
      item.alive = false;
      free[freeCount++] = index;
    },
    clear() {
      for (let i = 0; i < capacity; i++) {
        items[i]!.alive = false;
        leased[i] = 0;
        free[i] = capacity - i - 1;
      }
      freeCount = capacity;
    },
    forEachAlive(fn) {
      for (let i = 0; i < items.length; i++) {
        const item = items[i]!;
        if (item.alive) fn(item, i);
      }
    },
    aliveCount() {
      return capacity - freeCount;
    },
  };
}
