/** Shared FX math helpers (theme-agnostic). */

export function rand(min: number, max: number) {
  return min + Math.random() * (max - min);
}

export function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}
