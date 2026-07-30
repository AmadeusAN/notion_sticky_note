import { clamp, rand } from "../../math";
import type { DockEdge } from "../../types";
import { contrastProfile } from "../../appearance";
import { getFxAppearance } from "../../appearanceStore";

export type FringeMode = "strip" | "screen";

export interface FringeInk {
  id: number;
  along: number;
  offset: number;
  rot: number;
  scale: number;
  color: string;
  flip: boolean;
  variant: number;
}

let seq = 0;
const nextId = () => ++seq;

function inkColor(): string {
  const { luminance, fg } = getFxAppearance();
  const mode = contrastProfile(luminance).colorMode;
  if (mode === "onLight") {
    const darks = ["#1a1510", "#2a2218", "#3d3428", "#1f1a14", fg];
    return darks[Math.floor(Math.random() * darks.length)]!;
  }
  const lights = ["#e8e2d6", "#d4cfc4", "#f2eee6", "#c8c2b6", "#faf7f0"];
  return lights[Math.floor(Math.random() * lights.length)]!;
}

export function makeFringe(
  _edge: DockEdge,
  mode: FringeMode,
  count: number,
): FringeInk[] {
  const items: FringeInk[] = [];
  for (let i = 0; i < count; i++) {
    items.push({
      id: nextId(),
      along: ((i + 0.5) / count) * 100 + rand(-2, 2),
      offset: mode === "screen" ? rand(-22, -6) : rand(2, 14),
      rot: rand(-18, 18),
      scale: rand(0.65, 1.35),
      color: inkColor(),
      flip: Math.random() > 0.5,
      variant: i % 3,
    });
  }
  return items;
}

export function clampAlong(n: number, lo: number, hi: number) {
  return clamp(n, lo, hi);
}
