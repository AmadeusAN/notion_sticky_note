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

  return {
    capacity,
    items,
    acquire() {
      for (let i = 0; i < items.length; i++) {
        const item = items[i]!;
        if (!item.alive) {
          item.alive = true;
          return item;
        }
      }
      return null;
    },
    release(item) {
      item.alive = false;
    },
    clear() {
      for (const item of items) item.alive = false;
    },
    forEachAlive(fn) {
      for (let i = 0; i < items.length; i++) {
        const item = items[i]!;
        if (item.alive) fn(item, i);
      }
    },
    aliveCount() {
      let n = 0;
      for (const item of items) if (item.alive) n++;
      return n;
    },
  };
}
