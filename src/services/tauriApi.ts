import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { AppIconId, AppIconState, AppearanceSettings, AppearanceSaveState, ExitAction, ExitSaveState, GalleryFeedConfig, Group, NotionConfig, RemoteGalleryItem, SaveNotionConfigOptions, SaveNotionConfigResult, SettingsSnapshot, SyncState, Task, TaskImportResult, TaskScheduleInput, TaskUpdateInput, TaskView, WindowMode } from "../types";
import { ARCHIVE_GROUP_ID, MOCK_TASKS, NOTION_GROUP_ID } from "../types";
import { buildDateSummary, todayIso, offsetDateIso, validateSchedule } from "./taskDate";
import { DEFAULT_APP_ICON_ID, normalizeAppIconId } from "./appIcons";
import type { DockSnapshot } from "../fx/types";

export async function apiGetAutostartEnabled(): Promise<boolean> {
  return invoke<boolean>("get_autostart_enabled");
}

export async function apiSetAutostartEnabled(enabled: boolean): Promise<boolean> {
  return invoke<boolean>("set_autostart_enabled", { enabled });
}

function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

let previewWindowMode: WindowMode = "workspace";
const previewModeListeners = new Set<(mode: WindowMode) => void>();

export async function apiGetWindowMode(): Promise<WindowMode> {
  if (!isTauri()) return previewWindowMode;
  return invoke<WindowMode>("get_window_mode");
}

export async function apiSetWindowMode(mode: WindowMode): Promise<WindowMode> {
  if (!isTauri()) {
    previewWindowMode = mode;
    for (const listener of previewModeListeners) listener(mode);
    return mode;
  }
  return invoke<WindowMode>("set_window_mode", { mode });
}

export async function apiListenWindowMode(onMode: (mode: WindowMode) => void): Promise<UnlistenFn> {
  if (!isTauri()) {
    previewModeListeners.add(onMode);
    return () => { previewModeListeners.delete(onMode); };
  }
  return listen<WindowMode>("window-mode-changed", (event) => onMode(event.payload));
}

const PREVIEW_ALWAYS_ON_TOP_KEY = "sticky_preview_always_on_top";
const previewPinListeners = new Set<(pinned: boolean) => void>();

export async function apiGetAlwaysOnTop(): Promise<boolean> {
  if (!isTauri()) {
    try {
      return window.localStorage.getItem(PREVIEW_ALWAYS_ON_TOP_KEY) === "true";
    } catch {
      return false;
    }
  }
  return invoke<boolean>("get_always_on_top");
}

export async function apiSetAlwaysOnTop(pinned: boolean): Promise<boolean> {
  if (!isTauri()) {
    try {
      window.localStorage.setItem(PREVIEW_ALWAYS_ON_TOP_KEY, pinned ? "true" : "false");
    } catch {
      // Ignore storage unavailability in restricted contexts.
    }
    for (const listener of previewPinListeners) listener(pinned);
    return pinned;
  }
  return invoke<boolean>("set_always_on_top", { pinned });
}

export async function apiListenAlwaysOnTop(onPinned: (pinned: boolean) => void): Promise<UnlistenFn> {
  if (!isTauri()) {
    previewPinListeners.add(onPinned);
    return () => { previewPinListeners.delete(onPinned); };
  }
  return listen<boolean>("always-on-top-changed", (event) => onPinned(event.payload));
}

const PREVIEW_APP_ICON_ID_KEY = "sticky_preview_app_icon_id";
const PREVIEW_APP_ICON_CUSTOM_KEY = "sticky_preview_app_icon_custom";
const previewAppIconListeners = new Set<(state: AppIconState) => void>();

export async function apiGetAppIcon(): Promise<AppIconState> {
  if (!isTauri()) {
    try {
      const iconId = normalizeAppIconId(window.localStorage.getItem(PREVIEW_APP_ICON_ID_KEY));
      const customDataUrl = window.localStorage.getItem(PREVIEW_APP_ICON_CUSTOM_KEY) || null;
      return {
        iconId: iconId === "custom" && !customDataUrl ? DEFAULT_APP_ICON_ID : iconId,
        customDataUrl,
      };
    } catch {
      return { iconId: DEFAULT_APP_ICON_ID, customDataUrl: null };
    }
  }
  const raw = await invoke<{ iconId: string; customDataUrl: string | null }>("get_app_icon");
  return {
    iconId: normalizeAppIconId(raw.iconId),
    customDataUrl: raw.customDataUrl ?? null,
  };
}

export async function apiSetAppIcon(payload: {
  iconId: AppIconId;
  customDataUrl: string | null;
  rgba128: number[];
  rgba32: number[];
}): Promise<AppIconState> {
  if (!isTauri()) {
    let prevCustom: string | null = null;
    try {
      prevCustom = window.localStorage.getItem(PREVIEW_APP_ICON_CUSTOM_KEY) || null;
      window.localStorage.setItem(PREVIEW_APP_ICON_ID_KEY, payload.iconId);
      if (payload.customDataUrl) {
        window.localStorage.setItem(PREVIEW_APP_ICON_CUSTOM_KEY, payload.customDataUrl);
      }
    } catch {
      // Ignore storage unavailability.
    }
    const next: AppIconState = {
      iconId: normalizeAppIconId(payload.iconId),
      customDataUrl: payload.customDataUrl ?? prevCustom,
    };
    for (const listener of previewAppIconListeners) listener(next);
    return next;
  }
  const raw = await invoke<{ iconId: string; customDataUrl: string | null }>("set_app_icon", {
    payload,
  });
  return {
    iconId: normalizeAppIconId(raw.iconId),
    customDataUrl: raw.customDataUrl ?? null,
  };
}

export async function apiListenAppIcon(onIcon: (state: AppIconState) => void): Promise<UnlistenFn> {
  if (!isTauri()) {
    previewAppIconListeners.add(onIcon);
    return () => { previewAppIconListeners.delete(onIcon); };
  }
  return listen<{ iconId: string; customDataUrl: string | null }>("app-icon-changed", (event) => {
    onIcon({
      iconId: normalizeAppIconId(event.payload.iconId),
      customDataUrl: event.payload.customDataUrl ?? null,
    });
  });
}

export async function apiMinimizeMain(): Promise<void> {
  if (!isTauri()) return;
  await invoke("minimize_main");
}

export async function apiToggleMaximizeMain(): Promise<boolean> {
  if (!isTauri()) return false;
  return invoke<boolean>("toggle_maximize_main");
}

export async function apiIsMainMaximized(): Promise<boolean> {
  if (!isTauri()) return false;
  return invoke<boolean>("is_main_maximized");
}

export async function apiHideWindow(): Promise<void> {
  if (!isTauri()) throw new Error("请在桌面应用中隐藏窗口");
  await invoke("hide_main");
}

export async function apiGetEdgeDock(): Promise<DockSnapshot> {
  if (!isTauri()) return { revision: 0, phase: "free", edge: null, presented: true };
  return invoke<DockSnapshot>("get_edge_dock");
}

export async function apiListenEdgeDock(onState: (state: DockSnapshot) => void): Promise<UnlistenFn> {
  if (!isTauri()) return () => {};
  return listen<DockSnapshot>("edge-dock-changed", (event) => onState(event.payload));
}

let previewTasksState: Task[] | null = null;

function buildPreviewTasks(): Task[] {
  const now = Date.now();
  const today = todayIso();
  const inTwoDays = offsetDateIso(2);
  const tomorrow = offsetDateIso(1);
  return [
    ...MOCK_TASKS,
    {
      id: "preview-focus-1",
      notionId: null,
      title: "Polish sticky note layout",
      completed: false,
      progress: null,
      remain: null,
      date: today,
      startDate: today,
      endDate: null,
      startTime: null,
      endTime: null,
      reminderAt: now + 3_600_000,
      remindedAt: null,
      tags: [],
      updatedTime: now - 3000,
      groupId: "preview-focus",
      position: 1,
    },
    {
      id: "preview-focus-2",
      notionId: null,
      title: "Verify Apple-style drag physics",
      completed: false,
      progress: null,
      remain: null,
      date: `${today} 11:00–15:00`,
      startDate: today,
      endDate: null,
      startTime: "11:00",
      endTime: "15:00",
      reminderAt: null,
      remindedAt: null,
      tags: [],
      updatedTime: now - 2000,
      groupId: "preview-focus",
      position: 2,
    },
    {
      id: "preview-focus-3",
      notionId: null,
      title: "Ship clean SQLite v3 migration",
      completed: false,
      progress: null,
      remain: null,
      date: `${today} → ${inTwoDays}`,
      startDate: today,
      endDate: inTwoDays,
      startTime: null,
      endTime: null,
      reminderAt: null,
      remindedAt: null,
      tags: [],
      updatedTime: now - 1000,
      groupId: "preview-focus",
      position: 3,
    },
    {
      id: "preview-backlog-1",
      notionId: null,
      title: "Prepare V1.0.0 release notes",
      completed: false,
      progress: null,
      remain: null,
      date: tomorrow,
      startDate: tomorrow,
      endDate: null,
      startTime: null,
      endTime: null,
      reminderAt: null,
      remindedAt: null,
      tags: [],
      updatedTime: now - 500,
      groupId: "preview-backlog",
      position: 1,
    },
    {
      id: "preview-backlog-2",
      notionId: null,
      title: "Tidy workspace screenshots",
      completed: false,
      progress: null,
      remain: null,
      date: null,
      startDate: null,
      endDate: null,
      startTime: null,
      endTime: null,
      reminderAt: null,
      remindedAt: null,
      tags: [],
      updatedTime: now - 250,
      groupId: "preview-backlog",
      position: 2,
    },
    {
      id: "preview-archive-1",
      notionId: null,
      title: "Fix Windhawk undock FX glitch",
      completed: true,
      progress: null,
      remain: null,
      date: null,
      startDate: null,
      endDate: null,
      startTime: null,
      endTime: null,
      reminderAt: null,
      remindedAt: null,
      tags: [],
      updatedTime: now - 5000,
      groupId: ARCHIVE_GROUP_ID,
      position: 1,
    },
  ];
}

export async function apiGetTaskView(): Promise<TaskView> {
  if (!isTauri()) {
    if (!previewTasksState) previewTasksState = buildPreviewTasks();
    return {
      tasks: previewTasksState,
      groups: [
        { id: NOTION_GROUP_ID, name: "来自 Notion", kind: "notion", position: 0, createdAt: 0 },
        { id: "preview-focus", name: "Today", kind: "local", position: 1, createdAt: 1 },
        { id: "preview-backlog", name: "Backlog", kind: "local", position: 2, createdAt: 2 },
        { id: ARCHIVE_GROUP_ID, name: "Archive", kind: "archive", position: 0, createdAt: 3 },
      ],
    };
  }
  return invoke<TaskView>("get_task_view");
}

export async function apiCreateGroup(name: string): Promise<Group> {
  if (!isTauri()) throw new Error("浏览器预览不支持创建分组");
  return invoke<Group>("create_group", { name });
}

export async function apiDeleteGroup(id: string): Promise<string[]> {
  if (!isTauri()) throw new Error("浏览器预览不支持删除分组");
  return invoke<string[]>("delete_group", { id });
}

export async function apiReorderGroups(orderedIds: string[]): Promise<Group[] | null> {
  if (!isTauri()) return null;
  return invoke<Group[]>("reorder_groups", { orderedIds });
}

export async function apiReorderTasks(groupId: string, orderedIds: string[]): Promise<Task[] | null> {
  if (!isTauri()) return null;
  return invoke<Task[]>("reorder_tasks", { groupId, orderedIds });
}


export async function apiImportTasks(
  titles: string[],
  groupId: string | null,
  newGroupName: string | null,
  schedule?: TaskScheduleInput | null,
): Promise<TaskImportResult> {
  if (!isTauri()) throw new Error("浏览器预览不支持导入任务，请在桌面应用中使用");
  return invoke<TaskImportResult>("import_tasks", {
    titles,
    groupId,
    newGroupName,
    schedule: schedule ?? null,
  });
}

export async function apiUpdateTask(id: string, update: TaskUpdateInput): Promise<Task> {
  if (!isTauri()) {
    if (!previewTasksState) previewTasksState = buildPreviewTasks();
    const existing = previewTasksState.find((t) => t.id === id);
    if (!existing) throw new Error("任务不存在");
    if (existing.notionId || existing.groupId === NOTION_GROUP_ID) {
      throw new Error("来自 Notion 的同步任务请在 Notion 中编辑");
    }
    if (update.updateSchedule) {
      const err = validateSchedule({
        startDate: update.startDate ?? null,
        endDate: update.endDate ?? null,
        startTime: update.startTime ?? null,
        endTime: update.endTime ?? null,
        reminderAt: update.reminderAt ?? null,
      });
      if (err) throw new Error(err);
    }
    const nextTitle = update.title !== undefined ? update.title.trim() : existing.title;
    if (!nextTitle) throw new Error("任务标题不能为空");
    const nextGroupId =
      update.groupId && update.groupId !== existing.groupId ? update.groupId : existing.groupId;
    if (nextGroupId === NOTION_GROUP_ID || nextGroupId === ARCHIVE_GROUP_ID) {
      throw new Error("只能移动到自定义本地分组");
    }
    const nextSchedule = update.updateSchedule
      ? {
          startDate: update.startDate ?? null,
          endDate:
            update.endDate && update.endDate !== update.startDate ? update.endDate : null,
          startTime: update.startDate ? update.startTime ?? null : null,
          endTime: update.startDate && update.startTime ? update.endTime ?? null : null,
          reminderAt: update.reminderAt ?? null,
          remindedAt:
            update.reminderAt === existing.reminderAt ? (existing.remindedAt ?? null) : null,
          date: buildDateSummary({
            startDate: update.startDate,
            endDate: update.endDate,
            startTime: update.startDate ? update.startTime : null,
            endTime: update.startDate && update.startTime ? update.endTime : null,
          }),
        }
      : {
          startDate: existing.startDate ?? null,
          endDate: existing.endDate ?? null,
          startTime: existing.startTime ?? null,
          endTime: existing.endTime ?? null,
          reminderAt: existing.reminderAt ?? null,
          remindedAt: existing.remindedAt ?? null,
          date: existing.date,
        };
    const nextTask: Task = {
      ...existing,
      title: nextTitle,
      groupId: nextGroupId,
      ...nextSchedule,
      updatedTime: Date.now(),
    };
    previewTasksState = previewTasksState.map((t) => (t.id === id ? nextTask : t));
    return nextTask;
  }
  return invoke<Task>("update_task", { id, update });
}

export async function apiListenTaskReminder(onReminder: (task: Task) => void): Promise<UnlistenFn> {
  if (!isTauri()) return () => {};
  return listen<Task>("task-reminder-fired", (event) => onReminder(event.payload));
}

export async function apiDeleteTask(id: string): Promise<void> {
  if (!isTauri()) throw new Error("浏览器预览不支持删除任务");
  await invoke("delete_task", { id });
}

export async function apiClearArchive(): Promise<string[]> {
  if (!isTauri()) throw new Error("请在桌面应用中清空归档");
  return invoke<string[]>("clear_archive");
}

export async function apiToggleTask(id: string): Promise<Task> {
  if (!isTauri()) {
    if (!previewTasksState) previewTasksState = buildPreviewTasks();
    const target = previewTasksState.find((t) => t.id === id);
    if (!target || target.notionId || target.groupId === NOTION_GROUP_ID) {
      throw new Error("浏览器预览不修改 Notion，请使用桌面应用");
    }
    const next: Task = {
      ...target,
      completed: !target.completed,
      updatedTime: Date.now(),
    };
    previewTasksState = previewTasksState.map((t) => (t.id === id ? next : t));
    return next;
  }
  return invoke<Task>("toggle_task", { id });
}

export async function apiGetSettings(): Promise<SettingsSnapshot> {
  if (!isTauri()) {
    return {
      appearanceSaveState: { revision: 0, status: "error", error: "浏览器仅预览，外观设置不会保存。" },
      settings: {
      theme: "paper",
      lightTheme: "paper",
      darkTheme: "dark",
      font: "hand",
      fxTheme: "leaf",
      fxIntensity: 1,
      fxEdgeBoost: true,
      noteBg: "#f6f0df",
      noteFg: "#3a3226",
      noteAccent: "#c4a35a",
      notePop: "#e8a87c",
      dockHandle: "grip",
      notion: {
        token: "",
        databaseId: "",
        doneProperty: "done?",
        titleProperty: "Name",
        dateProperty: "Date",
        statusProperty: "Status",
        statusDoneValue: "Done",
        statusTodoValue: "Not started",
      },
      },
    };
  }
  return invoke<SettingsSnapshot>("get_settings");
}

export async function apiSaveNotionConfig(
  config: NotionConfig,
  options: SaveNotionConfigOptions = {},
): Promise<SaveNotionConfigResult> {
  if (!isTauri()) throw new Error("浏览器预览无法保存 Notion 配置，请使用桌面应用。");
  return invoke<SaveNotionConfigResult>("save_notion_config", { config, ...options });
}

export async function apiUpdateAppearance(
  appearance: AppearanceSettings,
  clientRevision: number,
): Promise<AppearanceSaveState> {
  if (!isTauri()) throw new Error("浏览器仅预览，外观设置不会保存。");
  return invoke<AppearanceSaveState>("update_appearance", { appearance, clientRevision });
}

export async function apiListenAppearanceSaveState(
  onState: (state: AppearanceSaveState) => void,
): Promise<UnlistenFn> {
  if (!isTauri()) return () => {};
  return listen<AppearanceSaveState>("appearance-save-state", (event) => onState(event.payload));
}

export async function apiGetExitState(): Promise<ExitSaveState> {
  if (!isTauri()) return { revision: 0, status: "idle", error: null };
  return invoke<ExitSaveState>("get_exit_state");
}

export async function apiListenExitSaveState(
  onState: (state: ExitSaveState) => void,
): Promise<UnlistenFn> {
  if (!isTauri()) return () => {};
  return listen<ExitSaveState>("exit-save-state", (event) => onState(event.payload));
}

export async function apiRequestExit(action?: ExitAction): Promise<ExitSaveState> {
  if (!isTauri()) throw new Error("浏览器预览不能保存设置或退出桌面应用。");
  return invoke<ExitSaveState>("request_exit", { action });
}

export async function apiForceSync(): Promise<SyncState> {
  if (!isTauri()) return previewSyncState();
  return invoke<SyncState>("force_sync");
}

export async function apiGetSyncState(): Promise<SyncState> {
  if (!isTauri()) return previewSyncState();
  return invoke<SyncState>("get_sync_state");
}

export async function apiListenSyncState(onState: (state: SyncState) => void): Promise<UnlistenFn> {
  if (!isTauri()) return () => {};
  return listen<SyncState>("sync-state-changed", (event) => onState(event.payload));
}

function previewSyncState(): SyncState {
  return { seq: 0, cycleId: 0, status: "unconfigured", lastSuccessfulAt: null,
    pendingCount: 0, unresolvedCount: 0, error: null, dataChanged: false };
}

export async function apiTestNotionConnection(
  config: NotionConfig,
): Promise<string> {
  if (!isTauri()) throw new Error("浏览器预览无法测试 Notion 连接，请使用桌面应用。");
  return invoke<string>("test_notion_connection", { config });
}

function makePreviewArtworkUri(title: string, c1: string, c2: string): string {
  const safe = title.replace(/[<>&"']/g, "");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="${c1}"/><stop offset="100%" stop-color="${c2}"/></linearGradient></defs><rect width="800" height="600" fill="url(#g)"/><circle cx="620" cy="140" r="140" fill="rgba(255,255,255,0.14)"/><circle cx="190" cy="470" r="180" fill="rgba(255,255,255,0.09)"/><text x="48" y="540" fill="rgba(255,255,255,0.85)" font-family="system-ui, sans-serif" font-size="24" font-weight="600">${safe}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export async function apiFetchGalleryFeed(config: GalleryFeedConfig): Promise<RemoteGalleryItem[]> {
  if (!isTauri()) {
    if (config.source === "pinterest") {
      if (!config.pinterestBoardUrl.trim()) {
        throw new Error("请先在设置中填写 Pinterest 公开画板链接");
      }
      return [
        {
          id: "preview-pin-1",
          title: "Pinterest Board Preview · Study Desk",
          imageUrl: makePreviewArtworkUri("Pinterest · Study Desk", "#432818", "#99582a"),
          sourceUrl: config.pinterestBoardUrl,
          author: null,
          provider: "pinterest",
        },
        {
          id: "preview-pin-2",
          title: "Pinterest Board Preview · Morning Light",
          imageUrl: makePreviewArtworkUri("Pinterest · Morning Light", "#1b263b", "#415a77"),
          sourceUrl: config.pinterestBoardUrl,
          author: null,
          provider: "pinterest",
        },
      ];
    }

    if (config.source === "unsplash") {
      if (!config.unsplashAccessKey.trim()) {
        throw new Error("请先在设置中填写 Unsplash Access Key");
      }
      const q = config.unsplashQuery.trim() || "minimal";
      return [
        {
          id: "preview-us-1",
          title: `Unsplash · ${q} #1`,
          imageUrl: makePreviewArtworkUri(`Unsplash · ${q}`, "#14213d", "#fca311"),
          sourceUrl: "https://unsplash.com",
          author: "Unsplash Preview",
          provider: "unsplash",
        },
        {
          id: "preview-us-2",
          title: `Unsplash · ${q} #2`,
          imageUrl: makePreviewArtworkUri(`Unsplash · ${q} II`, "#264653", "#2a9d8f"),
          sourceUrl: "https://unsplash.com",
          author: "Unsplash Preview",
          provider: "unsplash",
        },
      ];
    }

    const q = config.wallhavenQuery.trim() || "toplist";
    const pool: RemoteGalleryItem[] = [
      {
        id: "preview-wh-1",
        title: `Wallhaven · ${q} #1`,
        imageUrl: makePreviewArtworkUri(`Wallhaven · ${q} #1`, "#0f172a", "#6366f1"),
        sourceUrl: "https://wallhaven.cc",
        author: null,
        provider: "wallhaven",
      },
      {
        id: "preview-wh-2",
        title: `Wallhaven · ${q} #2`,
        imageUrl: makePreviewArtworkUri(`Wallhaven · ${q} #2`, "#1e1b4b", "#ec4899"),
        sourceUrl: "https://wallhaven.cc",
        author: null,
        provider: "wallhaven",
      },
      {
        id: "preview-wh-3",
        title: `Wallhaven · ${q} #3`,
        imageUrl: makePreviewArtworkUri(`Wallhaven · ${q} #3`, "#0f292e", "#14b8a6"),
        sourceUrl: "https://wallhaven.cc",
        author: null,
        provider: "wallhaven",
      },
    ];
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    return pool.slice(0, 2);
  }

  const query =
    config.source === "unsplash"
      ? config.unsplashQuery
      : config.source === "wallhaven"
        ? config.wallhavenQuery
        : "";
  return invoke<RemoteGalleryItem[]>("fetch_gallery_feed_cmd", {
    request: {
      source: config.source,
      query,
      boardUrl: config.pinterestBoardUrl,
      accessKey: config.unsplashAccessKey,
      proxyUrl: config.proxyUrl,
      limit: 12,
    },
  });
}

export async function apiOpenExternalUrl(url: string): Promise<void> {
  const trimmed = url.trim();
  if (!/^https?:\/\//i.test(trimmed)) {
    throw new Error("仅支持打开 http/https 来源链接");
  }
  if (!isTauri()) {
    window.open(trimmed, "_blank", "noopener,noreferrer");
    return;
  }
  return invoke("open_external_url_cmd", { url: trimmed });
}
