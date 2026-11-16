import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { AppearanceSettings, AppearanceSaveState, ExitAction, ExitSaveState, Group, NotionConfig, SaveNotionConfigOptions, SaveNotionConfigResult, SettingsSnapshot, SyncState, Task, TaskImportResult, TaskView } from "../types";
import { ARCHIVE_GROUP_ID, MOCK_TASKS, NOTION_GROUP_ID } from "../types";
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

export async function apiGetTaskView(): Promise<TaskView> {
  if (!isTauri()) {
    return { tasks: MOCK_TASKS, groups: [
      { id: NOTION_GROUP_ID, name: "来自 Notion", kind: "notion", position: 0, createdAt: 0 },
      { id: ARCHIVE_GROUP_ID, name: "Archive", kind: "archive", position: 0, createdAt: 0 },
    ] };
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


export async function apiImportTasks(
  titles: string[],
  groupId: string | null,
  newGroupName: string | null,
): Promise<TaskImportResult> {
  if (!isTauri()) throw new Error("浏览器预览不支持导入任务，请在桌面应用中使用");
  return invoke<TaskImportResult>("import_tasks", { titles, groupId, newGroupName });
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
  if (!isTauri()) throw new Error("浏览器预览不修改 Notion，请使用桌面应用");
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
