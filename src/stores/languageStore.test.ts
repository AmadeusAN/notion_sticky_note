import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { invoke, isTauri } from "@tauri-apps/api/core";
import type * as TauriCore from "@tauri-apps/api/core";
import { useLanguageStore } from "./languageStore";
import { useSettingsStore } from "./settingsStore";
import type { LanguageState } from "../i18n";

vi.mock("@tauri-apps/api/core", async (importOriginal) => ({
  ...(await importOriginal<typeof TauriCore>()),
  invoke: vi.fn(), isTauri: vi.fn(() => true),
}));

const initial = useLanguageStore.getState();
beforeEach(() => {
  vi.mocked(invoke).mockReset();
  vi.mocked(isTauri).mockReturnValue(true);
  useLanguageStore.setState({ ...initial, effective: "en", preference: "auto", hydrated: false,
    busy: false, saved: false, error: null, failure: null, requestedPreference: null }, true);
});
afterEach(() => {
  useLanguageStore.setState(initial, true);
  vi.unstubAllGlobals();
});

it("trusts the native effective auto locale even when navigator disagrees", async () => {
  vi.stubGlobal("navigator", { languages: ["en-US"], language: "en-US" });
  vi.mocked(invoke).mockResolvedValue({ preference: "auto", effective: "zh-CN" });
  await useLanguageStore.getState().hydrate();
  expect(invoke).toHaveBeenCalledWith("get_language_state");
  expect(useLanguageStore.getState()).toMatchObject({ preference: "auto", effective: "zh-CN", hydrated: true });
});

it("persists a manual choice through the dedicated native command and honors restart state", async () => {
  const appearance = useSettingsStore.getState();
  useLanguageStore.setState({ hydrated: true, effective: "zh-CN" });
  vi.mocked(invoke).mockResolvedValueOnce({ preference: "en", effective: "en" });
  await useLanguageStore.getState().setPreference("en");
  expect(invoke).toHaveBeenCalledWith("set_language", { preference: "en" });
  expect(useLanguageStore.getState()).toMatchObject({ preference: "en", effective: "en", saved: true });
  expect(useSettingsStore.getState()).toBe(appearance);
  useLanguageStore.setState({ preference: "auto", effective: "zh-CN", hydrated: false });
  vi.mocked(invoke).mockResolvedValueOnce({ preference: "en", effective: "en" });
  await useLanguageStore.getState().hydrate();
  expect(useLanguageStore.getState()).toMatchObject({ preference: "en", effective: "en", hydrated: true });
});

it("keeps the last acknowledged locale on save failure and retains the request for a later retry", async () => {
  useLanguageStore.setState({ preference: "zh-CN", effective: "zh-CN", hydrated: true, saved: true });
  vi.mocked(invoke).mockRejectedValueOnce(new Error("disk full"));
  await useLanguageStore.getState().setPreference("en");
  expect(useLanguageStore.getState()).toMatchObject({ preference: "zh-CN", effective: "zh-CN", saved: false,
    busy: false, failure: "save", error: "disk full", requestedPreference: "en" });
  vi.mocked(invoke).mockResolvedValueOnce({ preference: "en", effective: "en" });
  await useLanguageStore.getState().setPreference(useLanguageStore.getState().requestedPreference!);
  expect(useLanguageStore.getState()).toMatchObject({ preference: "en", effective: "en", saved: true, error: null });
});

it("does not permit a save after a failed initial read and does not overwrite native settings", async () => {
  vi.mocked(invoke).mockRejectedValueOnce(new Error("database unavailable"));
  await useLanguageStore.getState().hydrate();
  await useLanguageStore.getState().setPreference("en");
  expect(invoke).toHaveBeenCalledTimes(1);
  expect(useLanguageStore.getState()).toMatchObject({ hydrated: false, failure: "load", saved: false, busy: false });
});

it("prevents duplicate requests and accepts the native auto response rather than resolving it again", async () => {
  useLanguageStore.setState({ hydrated: true });
  let resolve!: (state: LanguageState) => void;
  vi.mocked(invoke).mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
  const pending = useLanguageStore.getState().setPreference("auto");
  await useLanguageStore.getState().setPreference("zh-CN");
  expect(invoke).toHaveBeenCalledTimes(1);
  expect(useLanguageStore.getState().busy).toBe(true);
  resolve({ preference: "auto", effective: "en" });
  await pending;
  expect(useLanguageStore.getState()).toMatchObject({ preference: "auto", effective: "en", busy: false });
});

it("selects the browser preference only in preview and never claims native persistence", async () => {
  vi.mocked(isTauri).mockReturnValue(false);
  vi.stubGlobal("navigator", { languages: ["zh-HK", "en-US"], language: "zh-HK" });
  await useLanguageStore.getState().hydrate();
  expect(useLanguageStore.getState().effective).toBe("zh-CN");
  await useLanguageStore.getState().setPreference("en");
  expect(useLanguageStore.getState()).toMatchObject({ effective: "en", preference: "en", saved: false });
  await useLanguageStore.getState().setPreference("auto");
  expect(useLanguageStore.getState().effective).toBe("zh-CN");
  expect(invoke).not.toHaveBeenCalled();
});
