/** Icicle fringe geometry; transient accents use the Canvas simulation. */

import type { DockEdge } from "../../types";
import { rand } from "../../math";

export interface FringeIcicle {
  id: number;
  along: number;
  offset: number;
  rot: number;
  scale: number;
  color: string;
  flip: boolean;
  variant: number;
}

export type FringeMode = "strip" | "screen";

const ICICLE_COLORS = [
  "#d8eef8",
  "#b8dcec",
  "#e8f6fc",
  "#9ecfe4",
  "#f2faff",
  "#c5e4f2",
  "#aed8ea",
];

let IcicleSeq = 0;

export function makeFringe(
  _edge: DockEdge,
  mode: FringeMode,
  count: number,
): FringeIcicle[] {
  const leaves: FringeIcicle[] = [];
  for (let i = 0; i < count; i++) {
    leaves.push({
      id: ++IcicleSeq,
      along: ((i + 0.5) / count) * 100 + rand(-1.5, 1.5),
      offset: mode === "screen" ? rand(-26, -6) : rand(2, 16),
      rot: rand(-10, 10),
      scale: rand(0.7, 1.55),
      color: ICICLE_COLORS[Math.floor(Math.random() * ICICLE_COLORS.length)]!,
      flip: Math.random() > 0.7,
      variant: i % 3,
    });
  }
  return leaves;
}
