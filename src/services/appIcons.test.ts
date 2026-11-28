import { describe, expect, it } from "vitest";
import {
  APP_ICON_PRESETS,
  DEFAULT_APP_ICON_ID,
  buildPresetIconSvg,
  normalizeAppIconId,
  presetIconDataUrl,
  resolveAppIconDataUrl,
  validateCustomIconFile,
} from "./appIcons";

describe("appIcons", () => {
  it("exposes all 7 built-in dark and light presets with C3 as default", () => {
    expect(DEFAULT_APP_ICON_ID).toBe("c3");
    expect(APP_ICON_PRESETS.map((p) => p.id)).toEqual([
      "c3",
      "c2",
      "c4",
      "l3a",
      "l3b",
      "l3c",
      "l3d",
    ]);
    for (const preset of APP_ICON_PRESETS) {
      const svg = buildPresetIconSvg(preset.id);
      expect(svg).toContain('viewBox="0 0 512 512"');
      expect(svg.startsWith("<svg")).toBe(true);
      expect(presetIconDataUrl(preset.id)).toMatch(/^data:image\/svg\+xml;charset=utf-8,/);
    }
  });

  it("normalizes unknown icon ids back to default and resolves custom previews safely", () => {
    expect(normalizeAppIconId("invalid")).toBe("c3");
    expect(normalizeAppIconId("l3b")).toBe("l3b");
    expect(normalizeAppIconId("custom")).toBe("custom");

    expect(resolveAppIconDataUrl("custom", "data:image/png;base64,ABC")).toBe(
      "data:image/png;base64,ABC",
    );
    expect(resolveAppIconDataUrl("custom", null)).toBe(presetIconDataUrl("c3"));
  });

  it("validates custom icon file types and size caps", () => {
    expect(validateCustomIconFile({ name: "my.png", type: "image/png", size: 2048 })).toBeNull();
    expect(
      validateCustomIconFile({ name: "my.svg", type: "image/svg+xml", size: 1024 }),
    ).toBeNull();
    expect(
      validateCustomIconFile({ name: "my.ico", type: "", size: 4096 }),
    ).toBeNull();
    expect(validateCustomIconFile({ name: "bad.txt", type: "text/plain", size: 100 })).not.toBeNull();
    expect(validateCustomIconFile({ name: "empty.png", type: "image/png", size: 0 })).not.toBeNull();
    expect(
      validateCustomIconFile({ name: "huge.png", type: "image/png", size: 6 * 1024 * 1024 }),
    ).not.toBeNull();
  });
});
