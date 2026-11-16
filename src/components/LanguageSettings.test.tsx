import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { invoke, isTauri } from "@tauri-apps/api/core";
import type * as TauriCore from "@tauri-apps/api/core";
import { LanguageSettings } from "./LanguageSettings";
import { useLanguageStore } from "../stores/languageStore";

vi.mock("@tauri-apps/api/core", async (importOriginal) => ({
  ...(await importOriginal<typeof TauriCore>()), invoke: vi.fn(), isTauri: vi.fn(() => true),
}));
const environment: typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean } = globalThis;
environment.IS_REACT_ACT_ENVIRONMENT = true;
const initial = useLanguageStore.getState();
let container: HTMLDivElement;
let root: Root;
beforeEach(async () => {
  vi.mocked(invoke).mockReset();
  vi.mocked(isTauri).mockReturnValue(true);
  useLanguageStore.setState({ ...initial, preference: "en", effective: "en", hydrated: true,
    busy: false, saved: false, error: null, failure: null, requestedPreference: null }, true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<LanguageSettings />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  useLanguageStore.setState(initial, true);
});

it("never announces a failed preference as saved and can retry after the settings view remounts", async () => {
  vi.mocked(invoke).mockRejectedValueOnce(new Error("disk full"));
  const select = container.querySelector("select")!;
  await act(async () => {
    select.value = "zh-CN";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(select.value).toBe("en");
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("Language was not saved: disk full");
  expect(container.textContent).not.toContain("Language saved");
  await act(async () => root.render(null));
  await act(async () => root.render(<LanguageSettings />));
  vi.mocked(invoke).mockResolvedValueOnce({ preference: "zh-CN", effective: "zh-CN" });
  await act(async () => container.querySelector("button")!.click());
  expect(invoke).toHaveBeenLastCalledWith("set_language", { preference: "zh-CN" });
  expect(container.querySelector("select")?.value).toBe("zh-CN");
  expect(container.querySelector('[role="status"]')?.textContent).toBe("语言已保存");
  expect(container.querySelector('[role="alert"]')).toBeNull();
});

it("keeps a failed read visible and disables preference writes until it is retried", async () => {
  await act(async () => useLanguageStore.setState({ hydrated: false, failure: "load", error: "database unavailable" }));
  expect(container.querySelector("select")?.disabled).toBe(true);
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("Unable to load language");
  vi.mocked(invoke).mockResolvedValueOnce({ preference: "auto", effective: "zh-CN" });
  await act(async () => container.querySelector("button")!.click());
  expect(invoke).toHaveBeenCalledWith("get_language_state");
  expect(container.querySelector("select")?.disabled).toBe(false);
  expect(container.querySelector("select")?.value).toBe("auto");
  expect(container.querySelector('[role="status"]')).toBeNull();
});

it("labels browser language changes as preview-only rather than persisted", async () => {
  vi.mocked(isTauri).mockReturnValue(false);
  await act(async () => root.render(<LanguageSettings />));
  const select = container.querySelector("select")!;
  await act(async () => {
    select.value = "zh-CN";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(container.textContent).toContain("不会保存到桌面应用");
  expect(container.querySelector('[role="status"]')).toBeNull();
  expect(invoke).not.toHaveBeenCalled();
});
