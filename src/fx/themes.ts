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
  { id: FxThemeId; label: string }
> = {
  leaf: { id: "leaf", label: "叶片" },
  sakura: { id: "sakura", label: "樱花" },
  vine: { id: "vine", label: "藤蔓" },
  icicle: { id: "icicle", label: "冰锥" },
  rain: { id: "rain", label: "雨滴" },
  snow: { id: "snow", label: "雪花" },
  ink: { id: "ink", label: "墨迹" },
  firefly: { id: "firefly", label: "萤火" },
  none: { id: "none", label: "关闭" },
};

export const fxThemeIds = Object.keys(fxThemes) as FxThemeId[];

export function normalizeFxThemeId(
  value: string | undefined | null,
  fallback: FxThemeId = DEFAULT_FX_THEME,
): FxThemeId {
  if (value && value in fxThemes) return value as FxThemeId;
  return fallback;
}
