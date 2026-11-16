import { expect, it } from "vitest";
import { buildAppearance, contrastProfile, densityTarget, particleGain } from "../appearance";

it("reuses per-appearance near/far gains while preserving contrast and density formulas", () => {
  for (const bg of ["#f6f0df", "#181820"]) {
    for (const intensity of [0.4, 1, 1.6]) {
      for (const edgeBoost of [false, true]) {
        const appearance = buildAppearance({ bg, intensity, edgeBoost });
        const profile = contrastProfile(appearance.luminance);
        for (const depth of [0, 0.55, 0.551, 1]) {
          const near = depth > 0.55;
          let expected = intensity * profile.alphaMul * (near ? profile.nearMul : profile.farMul);
          if (edgeBoost && near) expected *= profile.edgeMul;
          const gain = particleGain(appearance, depth);
          expect(gain.mul).toBe(expected);
          expect(gain.near).toBe(near);
          expect(particleGain(appearance, depth)).toBe(gain);
          expect(gain.profile).toEqual(profile);
        }
        expect(densityTarget(appearance, 110)).toBe(Math.round(110 * intensity * profile.densityMul));
      }
    }
  }
});

it("does not retain the old appearance's gains after a new preview", () => {
  const light = buildAppearance({ bg: "#fff", intensity: 1, edgeBoost: true });
  const dark = buildAppearance({ bg: "#111", intensity: 0.4, edgeBoost: false });
  expect(particleGain(light, 1).profile.colorMode).toBe("onLight");
  expect(particleGain(dark, 1).profile.colorMode).toBe("onDark");
  expect(particleGain(light, 1).mul).not.toBe(particleGain(dark, 1).mul);
});
