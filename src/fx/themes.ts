export type FxThemeId =
  | "leaf"
  | "sakura"
  | "vine"
  | "icicle"
  | "rain"
  | "snow"
  | "ink"
  | "firefly"
  | "none";

export const DEFAULT_FX_THEME: FxThemeId = "leaf";

export const fxThemes: Record<
  FxThemeId,
  { id: FxThemeId; label: string; staticFringe: boolean }
> = {
  leaf: { id: "leaf", label: "叶片", staticFringe: true },
  sakura: { id: "sakura", label: "樱花", staticFringe: true },
  vine: { id: "vine", label: "藤蔓", staticFringe: true },
  icicle: { id: "icicle", label: "冰锥", staticFringe: true },
  rain: { id: "rain", label: "雨滴", staticFringe: false },
  snow: { id: "snow", label: "雪花", staticFringe: false },
  ink: { id: "ink", label: "墨迹", staticFringe: true },
  firefly: { id: "firefly", label: "萤火", staticFringe: false },
  none: { id: "none", label: "关闭", staticFringe: false },
};

export const fxThemeIds = Object.keys(fxThemes) as FxThemeId[];

export function normalizeFxThemeId(
  value: string | undefined | null,
  fallback: FxThemeId = DEFAULT_FX_THEME,
): FxThemeId {
  if (value && value in fxThemes) return value as FxThemeId;
  return fallback;
}

export function hasStaticFxFringe(value: string | undefined | null): boolean {
  return !!fxThemes[normalizeFxThemeId(value, "none")]?.staticFringe;
}
