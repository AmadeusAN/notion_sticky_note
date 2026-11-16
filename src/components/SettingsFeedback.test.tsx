import { useLanguageStore } from "../stores/languageStore";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type * as TauriApi from "../services/tauriApi";
import type * as Fonts from "../fonts";
import type { AppearanceSaveState, ExitSaveState } from "../types";

vi.mock("../services/tauriApi", async (importOriginal) => ({
  ...(await importOriginal<typeof TauriApi>()),
  apiGetSettings: vi.fn(), apiUpdateAppearance: vi.fn(),
  apiListenAppearanceSaveState: vi.fn(), apiListenExitSaveState: vi.fn(),
  apiGetExitState: vi.fn(), apiRequestExit: vi.fn(),
}));
vi.mock("../fonts", async (importOriginal) => ({
  ...(await importOriginal<typeof Fonts>()), ensureFontLoaded: vi.fn(),
}));
vi.mock("./AutostartSettings", () => ({ AutostartSettings: () => null }));

import * as api from "../services/tauriApi";
import { useSettingsStore } from "../stores/settingsStore";
import { SettingsPanel } from "./SettingsPanel";
import { AppearanceFeedback } from "./AppearanceFeedback";
import { ExitSaveDialog } from "./ExitSaveDialog";

const reactEnvironment: typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean } = globalThis;
reactEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
const initial = useSettingsStore.getState();
let container: HTMLDivElement;
let root: Root;
let stop: () => void;
let appearanceEvent: (state: AppearanceSaveState) => void;
let exitEvent: (state: ExitSaveState) => void;
const retryHydration = vi.fn();

function Host() {
  const [open, setOpen] = useState(true);
  const exit = useSettingsStore((s) => s.exitSaveState);
  const modal = exit.status === "error" || (exit.status === "saving" && exit.error !== null);
  return <>
    <div inert={modal}>
      {open ? <SettingsPanel onClose={() => setOpen(false)} /> : <button onClick={() => setOpen(true)}>设置入口</button>}
      <AppearanceFeedback settingsOpen={open} onOpenSettings={() => setOpen(true)} onRetryHydration={retryHydration} />
    </div>
    <ExitSaveDialog />
  </>;
}

function button(text: string) {
  const found = [...container.querySelectorAll<HTMLButtonElement>("button")].find((element) => element.textContent === text);
  if (!found) throw new Error(`Missing button: ${text}`);
  return found;
}

beforeEach(async () => {
  useLanguageStore.setState({ preference: "zh-CN", effective: "zh-CN", hydrated: true, error: null, failure: null, saved: false });
  vi.resetAllMocks();
  vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  useSettingsStore.setState(initial, true);
  vi.mocked(api.apiGetSettings).mockResolvedValue({ settings: { ...initial },
    appearanceSaveState: { revision: 4, status: "saved", error: null } });
  vi.mocked(api.apiUpdateAppearance).mockImplementation(async (_appearance, revision) => ({ revision, status: "saving", error: null }));
  vi.mocked(api.apiListenAppearanceSaveState).mockImplementation(async (callback) => { appearanceEvent = callback; return vi.fn(); });
  vi.mocked(api.apiListenExitSaveState).mockImplementation(async (callback) => { exitEvent = callback; return vi.fn(); });
  vi.mocked(api.apiGetExitState).mockResolvedValue({ revision: 0, status: "idle", error: null });
  vi.mocked(api.apiRequestExit).mockImplementation(async (action) => ({ revision: 8, status: action === "cancel" ? "idle" : "error", error: action === "cancel" ? null : "disk full" }));
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    stop = useSettingsStore.getState().connectSettings();
    root.render(<Host />);
  });
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
    stop();
    await useSettingsStore.getState().flushAppearance();
  });
  container.remove();
  useSettingsStore.setState(initial, true);
  vi.unstubAllGlobals();
});

it("flushes the last slider value on close and exposes failure/retry after the panel unmounts", async () => {
  const slider = container.querySelector<HTMLInputElement>("#appearance-intensity")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(slider, "140");
    slider.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(useSettingsStore.getState().fxIntensity).toBe(1.4);
  expect(api.apiUpdateAppearance).not.toHaveBeenCalled();
  await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="关闭"]')!.click());
  expect(container.querySelector("#appearance-intensity")).toBeNull();
  expect(api.apiUpdateAppearance).toHaveBeenCalledWith(expect.objectContaining({ fxIntensity: 1.4 }), 5);
  await act(async () => appearanceEvent({ revision: 5, status: "error", error: "disk full" }));
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("未保存");
  await act(async () => button("重试保存").click());
  expect(api.apiUpdateAppearance).toHaveBeenLastCalledWith(expect.objectContaining({ fxIntensity: 1.4 }), 6);
  await act(async () => appearanceEvent({ revision: 6, status: "error", error: "disk full" }));
  await act(async () => button("打开设置").click());
  expect(container.querySelector<HTMLInputElement>("#appearance-intensity")?.value).toBe("140");
});

it("keeps hydration failure visible with disabled settings and a retry entry", async () => {
  await act(async () => useSettingsStore.setState({ hydrated: false, hydrationError: "database unavailable" }));
  const fieldset = container.querySelector<HTMLFieldSetElement>('fieldset[aria-label="外观"]')!;
  expect(fieldset.disabled).toBe(true);
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("database unavailable");
  await act(async () => button("重试读取设置").click());
  expect(retryHydration).toHaveBeenCalledTimes(1);
  expect(api.apiUpdateAppearance).not.toHaveBeenCalled();
});

it("makes the exit failure keyboard-modal, retains busy feedback, and cancels without a late reopen", async () => {
  const origin = container.querySelector<HTMLButtonElement>('button[aria-label="关闭"]')!;
  origin.focus();
  await act(async () => exitEvent({ revision: 7, status: "error", error: "disk full" }));
  const dialog = container.querySelector<HTMLElement>('[role="alertdialog"]')!;
  expect(dialog.getAttribute("aria-modal")).toBe("true");
  expect(document.activeElement).toBe(button("取消"));
  const discard = button("放弃未保存设置退出");
  discard.focus();
  await act(async () => discard.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true })));
  expect(document.activeElement).toBe(button("重试保存并退出"));

  let resolveExit!: (state: ExitSaveState) => void;
  vi.mocked(api.apiRequestExit).mockReturnValueOnce(new Promise<ExitSaveState>((resolve) => { resolveExit = resolve; }));
  await act(async () => button("重试保存并退出").click());
  expect(dialog.getAttribute("aria-busy")).toBe("true");
  expect(button("保存并退出中…").disabled).toBe(true);
  expect(button("放弃未保存设置退出").disabled).toBe(true);
  expect(button("取消").disabled).toBe(false);
  await act(async () => dialog.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
  expect(api.apiRequestExit).toHaveBeenLastCalledWith("cancel");
  expect(container.querySelector('[role="alertdialog"]')).toBeNull();
  expect(document.activeElement).toBe(origin);
  await act(async () => {
    resolveExit({ revision: 7, status: "error", error: "late failure" });
    exitEvent({ revision: 7, status: "error", error: "late failure" });
  });
  expect(container.querySelector('[role="alertdialog"]')).toBeNull();
});

it("requires the explicit discard action rather than silently reporting an exit succeeded", async () => {
  await act(async () => exitEvent({ revision: 7, status: "error", error: "disk full" }));
  await act(async () => button("放弃未保存设置退出").click());
  expect(api.apiRequestExit).toHaveBeenCalledWith("discard");
  expect(container.querySelector('[role="alertdialog"]')).not.toBeNull();
  expect(container.textContent).toContain("disk full");
});

it("renders English settings, appearance choices and save feedback from the independent locale", async () => {
  await act(async () => useLanguageStore.setState({ preference: "en", effective: "en" }));
  expect(container.querySelector("h2")?.textContent).toBe("Settings");
  expect(container.querySelector('label[for="app-language"]')?.textContent).toBe("Language");
  expect(container.querySelector('fieldset[aria-label="Appearance"]')).not.toBeNull();
  expect(container.querySelector('label[for="appearance-font"]')?.textContent).toBe("Font");
  expect(container.querySelector('label[for="appearance-fx-theme"]')?.textContent).toBe("Edge effects");
  expect(container.querySelector('#appearance-fx-theme option[value="sakura"]')?.textContent).toBe("Sakura");
  expect(container.querySelector('#appearance-dock-handle option[value="grip"]')?.textContent).toBe("Grip");
  expect(container.querySelector('label[for="notion-done"]')?.textContent).toBe("Completed property (Checkbox)");
  expect(container.querySelector('label[for="notion-title"]')?.textContent).toBe("Title property");
  await act(async () => appearanceEvent({ revision: 5, status: "error", error: "外观设置保存失败" }));
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("Not saved · Unable to save appearance settings");
  expect(button("Retry save")).not.toBeNull();
});
