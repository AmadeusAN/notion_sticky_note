import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../services/tauriApi", () => ({
  apiGetAlwaysOnTop: vi.fn(),
  apiGetWindowMode: vi.fn(),
  apiIsMainMaximized: vi.fn(),
  apiListenAlwaysOnTop: vi.fn(),
  apiListenWindowMode: vi.fn(),
  apiMinimizeMain: vi.fn(),
  apiSetAlwaysOnTop: vi.fn(),
  apiSetWindowMode: vi.fn(),
  apiToggleMaximizeMain: vi.fn(),
}));

import * as api from "../services/tauriApi";
import { createModeStore } from "./modeStore";

describe("modeStore", () => {
  let store: ReturnType<typeof createModeStore>;

  beforeEach(() => {
    vi.resetAllMocks();
    window.localStorage.removeItem("sticky_calendar_focus_style");
    window.localStorage.removeItem("sticky_calendar_focus_size");
    window.localStorage.removeItem("sticky_gallery_config");
    store = createModeStore();
    vi.mocked(api.apiGetAlwaysOnTop).mockResolvedValue(false);
    vi.mocked(api.apiGetWindowMode).mockResolvedValue("workspace");
    vi.mocked(api.apiIsMainMaximized).mockResolvedValue(false);
    vi.mocked(api.apiListenAlwaysOnTop).mockResolvedValue(() => {});
    vi.mocked(api.apiListenWindowMode).mockResolvedValue(() => {});
    vi.mocked(api.apiSetAlwaysOnTop).mockImplementation(async (pinned) => pinned);
    vi.mocked(api.apiSetWindowMode).mockImplementation(async (mode) => mode);
    vi.mocked(api.apiToggleMaximizeMain).mockResolvedValue(true);
    vi.mocked(api.apiMinimizeMain).mockResolvedValue();
  });

  it("hydrates initial mode and alwaysOnTop and toggles across modes", async () => {
    const disconnect = store.getState().connectWindowMode();
    await Promise.resolve();
    await Promise.resolve();
    expect(store.getState().mode).toBe("workspace");
    expect(store.getState().alwaysOnTop).toBe(false);

    await store.getState().toggleAlwaysOnTop();
    expect(api.apiSetAlwaysOnTop).toHaveBeenCalledWith(true);
    expect(store.getState().alwaysOnTop).toBe(true);

    await store.getState().setMode("sticky");
    expect(api.apiSetWindowMode).toHaveBeenCalledWith("sticky");
    expect(store.getState().mode).toBe("sticky");
    expect(store.getState().maximized).toBe(false);
    expect(store.getState().alwaysOnTop).toBe(true);

    await store.getState().toggleAlwaysOnTop();
    expect(api.apiSetAlwaysOnTop).toHaveBeenCalledWith(false);
    expect(store.getState().alwaysOnTop).toBe(false);

    await store.getState().setMode("workspace");
    expect(api.apiSetWindowMode).toHaveBeenCalledWith("workspace");
    expect(store.getState().mode).toBe("workspace");

    await store.getState().toggleMaximize();
    expect(store.getState().maximized).toBe(true);
    disconnect();
  });

  it("defaults calendarFocusStyle to smooth, persists changes, and toggles back to last active style", () => {
    expect(store.getState().calendarFocusStyle).toBe("smooth");

    store.getState().setCalendarFocusStyle("mosaic");
    expect(store.getState().calendarFocusStyle).toBe("mosaic");
    expect(window.localStorage.getItem("sticky_calendar_focus_style")).toBe("mosaic");

    store.getState().toggleCalendarFocus();
    expect(store.getState().calendarFocusStyle).toBe("off");
    expect(window.localStorage.getItem("sticky_calendar_focus_style")).toBe("off");

    store.getState().toggleCalendarFocus();
    expect(store.getState().calendarFocusStyle).toBe("mosaic");

    // Rehydrated store picks up saved focus style.
    const reloaded = createModeStore();
    expect(reloaded.getState().calendarFocusStyle).toBe("mosaic");

    expect(store.getState().calendarFocusSize).toBe(1);
    store.getState().setCalendarFocusSize(0.1);
    expect(store.getState().calendarFocusSize).toBe(0.65);
    store.getState().setCalendarFocusSize(3);
    expect(store.getState().calendarFocusSize).toBe(1.45);
    store.getState().setCalendarFocusSize(1.25);
    expect(store.getState().calendarFocusSize).toBe(1.25);
    expect(window.localStorage.getItem("sticky_calendar_focus_size")).toBe("1.25");
    expect(createModeStore().getState().calendarFocusSize).toBe(1.25);

    expect(store.getState().galleryConfig.source).toBe("local");
    store.getState().updateGalleryConfig({
      source: "wallhaven",
      wallhavenQuery: "cyberpunk",
      wallhavenTags: ["anime", "cyberpunk", "ghibli"],
      proxyUrl: "http://127.0.0.1:7897",
    });
    expect(store.getState().galleryConfig.source).toBe("wallhaven");
    expect(store.getState().galleryConfig.wallhavenQuery).toBe("cyberpunk");
    expect(store.getState().galleryConfig.wallhavenTags).toEqual(["anime", "cyberpunk", "ghibli"]);
    expect(store.getState().galleryConfig.proxyUrl).toBe("http://127.0.0.1:7897");
    expect(createModeStore().getState().galleryConfig.wallhavenTags).toEqual(["anime", "cyberpunk", "ghibli"]);
    expect(createModeStore().getState().galleryConfig.proxyUrl).toBe("http://127.0.0.1:7897");
  });
});
