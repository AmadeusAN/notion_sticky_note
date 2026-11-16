/** FX appearance: contrast vs note background + user intensity / edge boost. */

export type FxColorMode = "onLight" | "onDark";

export interface FxAppearance {
  bg: string;
  fg: string;
  accent: string;
  pop: string;
  intensity: number;
  edgeBoost: boolean;
  luminance: number;
}

export interface FxContrastProfile {
  colorMode: FxColorMode;
  densityMul: number;
  nearMul: number;
  farMul: number;
  alphaMul: number;
  edgeMul: number;
}

export const DEFAULT_FX_INTENSITY = 1;
export const MIN_FX_INTENSITY = 0.4;
export const MAX_FX_INTENSITY = 1.6;
export const DEFAULT_FX_EDGE_BOOST = true;

export const DEFAULT_FX_APPEARANCE: FxAppearance = {
  bg: "#f6f0df",
  fg: "#3a3226",
  accent: "#c4a35a",
  pop: "#e8a87c",
  intensity: DEFAULT_FX_INTENSITY,
  edgeBoost: DEFAULT_FX_EDGE_BOOST,
  luminance: 0.9,
};

/** Relative luminance 0–1 from #rgb / #rrggbb. */
export function luminance(hex: string): number {
  const raw = hex.trim().replace("#", "");
  if (raw.length !== 3 && raw.length !== 6) return 0.5;
  const full =
    raw.length === 3
      ? raw
          .split("")
          .map((c) => c + c)
          .join("")
      : raw;
  const r = parseInt(full.slice(0, 2), 16) / 255;
  const g = parseInt(full.slice(2, 4), 16) / 255;
  const b = parseInt(full.slice(4, 6), 16) / 255;
  const lin = (c: number) =>
    c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function clampIntensity(n: number): number {
  return Math.min(MAX_FX_INTENSITY, Math.max(MIN_FX_INTENSITY, n));
}

export function contrastProfile(lum: number): FxContrastProfile {
  const onLight = lum >= 0.55;
  if (onLight) {
    return {
      colorMode: "onLight",
      densityMul: 1.15,
      nearMul: 1.22,
      farMul: 0.95,
      alphaMul: 1.12,
      edgeMul: 1.35,
    };
  }
  return {
    colorMode: "onDark",
    densityMul: 1,
    nearMul: 1.05,
    farMul: 0.85,
    alphaMul: 1,
    edgeMul: 1.25,
  };
}

export function buildAppearance(
  partial: Partial<FxAppearance> & Pick<FxAppearance, "bg">,
): FxAppearance {
  const bg = partial.bg || DEFAULT_FX_APPEARANCE.bg;
  return {
    bg,
    fg: partial.fg ?? DEFAULT_FX_APPEARANCE.fg,
    accent: partial.accent ?? DEFAULT_FX_APPEARANCE.accent,
    pop: partial.pop ?? DEFAULT_FX_APPEARANCE.pop,
    intensity: clampIntensity(
      partial.intensity ?? DEFAULT_FX_APPEARANCE.intensity,
    ),
    edgeBoost: partial.edgeBoost ?? DEFAULT_FX_APPEARANCE.edgeBoost,
    luminance: luminance(bg),
  };
}

export interface FxParticleGain {
  mul: number;
  profile: FxContrastProfile;
  near: boolean;
}

const derivedAppearances = new WeakMap<
  FxAppearance,
  { near: FxParticleGain; far: FxParticleGain }
>();

function derivedAppearance(appearance: FxAppearance) {
  let derived = derivedAppearances.get(appearance);
  if (!derived) {
    const profile = contrastProfile(appearance.luminance);
    const alpha = appearance.intensity * profile.alphaMul;
    derived = {
      near: {
        mul: alpha * profile.nearMul * (appearance.edgeBoost ? profile.edgeMul : 1),
        profile,
        near: true,
      },
      far: { mul: alpha * profile.farMul, profile, near: false },
    };
    derivedAppearances.set(appearance, derived);
  }
  return derived;
}

/** Effective multipliers for a particle at depth 0..1 (1 = near). */
export function particleGain(appearance: FxAppearance, depth: number) {
  const derived = derivedAppearance(appearance);
  return depth > 0.55 ? derived.near : derived.far;
}

export function densityTarget(
  appearance: FxAppearance,
  base: number,
): number {
  return Math.round(base * appearance.intensity * derivedAppearance(appearance).near.profile.densityMul);
}

/** CSS custom properties for DOM fringe themes. */
export function appearanceCssVars(appearance: FxAppearance): Record<string, string> {
  const profile = derivedAppearance(appearance).near.profile;
  const edge = appearance.edgeBoost ? profile.edgeMul : 1;
  return {
    "--fx-intensity": String(appearance.intensity),
    "--fx-near-mul": String(profile.nearMul),
    "--fx-far-mul": String(profile.farMul),
    "--fx-edge-boost": String(edge),
    "--fx-alpha-mul": String(profile.alphaMul),
    "--fx-accent": appearance.accent,
    "--fx-pop": appearance.pop,
    "--fx-fg": appearance.fg,
    "--fx-bg": appearance.bg,
  };
}
