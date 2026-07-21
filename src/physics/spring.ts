/** Lightweight spring damper for sticky-note tilt / lag visuals. */

export interface SpringState {
  x: number;
  v: number;
}

export function createSpring(initial = 0): SpringState {
  return { x: initial, v: 0 };
}

export function stepSpring(
  state: SpringState,
  target: number,
  dt: number,
  stiffness = 180,
  damping = 18,
): SpringState {
  const force = -stiffness * (state.x - target) - damping * state.v;
  const v = state.v + force * dt;
  const x = state.x + v * dt;
  return { x, v };
}

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}
