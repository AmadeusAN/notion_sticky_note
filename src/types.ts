import type { ThemeId } from "./themes";
import type { FontId } from "./fonts";
import type { FxThemeId } from "./fx/themes";
import type { DockHandleId } from "./dockHandles";

export type { ThemeId } from "./themes";
export type { FontId } from "./fonts";
export type { FxThemeId } from "./fx/themes";
export type { DockHandleId } from "./dockHandles";

export interface Task {
  id: string;
  notionId: string | null;
  title: string;
  completed: boolean;
  progress: string | null;
  remain: string | null;
  date: string | null;
  tags: string[];
  updatedTime: number;
  /** Owning group id; synced Notion rows live in NOTION_GROUP_ID. */
  groupId: string;
}

export interface TaskView {
  tasks: Task[];
  groups: Group[];
}

export type GroupKind = "notion" | "local" | "archive";

export interface Group {
  id: string;
  name: string;
  kind: GroupKind;
  position: number;
  createdAt: number;
}

export interface TaskImportResult {
  group: Group;
  tasks: Task[];
}

/** Pinned, non-deletable group that receives all Notion-synced tasks. */
export const NOTION_GROUP_ID = "notion";
export const ARCHIVE_GROUP_ID = "archive";

export interface NotionConfig {
  token: string;
  databaseId: string;
  doneProperty: string;
  titleProperty: string;
  dateProperty: string;
  /** Notion Status property mirrored on toggle; empty to skip */
  statusProperty: string;
  statusDoneValue: string;
  statusTodoValue: string;
}

export type SaveNotionConfigResult =
  | { status: "saved" }
  | {
      status: "confirmationRequired";
      pendingCount: number;
      pendingVersion: number;
    };

export interface SaveNotionConfigOptions {
  discardPending?: boolean;
  expectedPendingVersion?: number;
}

export function isNotionConfigured(config: NotionConfig): boolean {
  return Boolean(config.token.trim() && config.databaseId.trim());
}

export interface AppSettings {
  theme: ThemeId;
  lightTheme: ThemeId;
  darkTheme: ThemeId;
  font: FontId;
  fxTheme: FxThemeId;
  fxIntensity: number;
  fxEdgeBoost: boolean;
  noteBg?: string;
  noteFg?: string;
  noteAccent?: string;
  notePop?: string;
  dockHandle: DockHandleId;
  notion: NotionConfig;
}

export type AppearanceSettings = Omit<AppSettings, "notion"> & {
  noteBg: string;
  noteFg: string;
  noteAccent: string;
  notePop: string;
};

export interface AppearanceSaveState {
  revision: number;
  status: "saving" | "saved" | "error";
  error: string | null;
}

export interface SettingsSnapshot {
  settings: AppSettings;
  appearanceSaveState: AppearanceSaveState;
}

export interface ExitSaveState {
  revision: number;
  status: "idle" | "saving" | "error";
  error: string | null;
}

export type ExitAction = "retry" | "cancel" | "discard";

export type SyncStatus = "unconfigured" | "idle" | "syncing" | "ok" | "error";

export interface SyncState {
  seq: number;
  cycleId: number;
  status: SyncStatus;
  lastSuccessfulAt: number | null;
  pendingCount: number;
  unresolvedCount: number;
  error: { category: string; message: string; status: number | null; code: string | null; retryAfterMs: number | null } | null;
  dataChanged: boolean;
}

export const MOCK_TASKS: Task[] = [
  {
    id: "local-1",
    notionId: null,
    title: "Demo: Plan a project",
    completed: false,
    progress: "30%",
    remain: "2d",
    date: "2026-07-22",
    tags: ["research"],
    updatedTime: Date.now(),
    groupId: NOTION_GROUP_ID,
  },
  {
    id: "local-2",
    notionId: null,
    title: "Demo: Set up a task database",
    completed: true,
    progress: "100%",
    remain: "0d",
    date: "2026-07-18",
    tags: ["setup"],
    updatedTime: Date.now(),
    groupId: NOTION_GROUP_ID,
  },
  {
    id: "local-3",
    notionId: null,
    title: "Demo: Review the design",
    completed: false,
    progress: "60%",
    remain: "1d",
    date: null,
    tags: ["ui"],
    updatedTime: Date.now(),
    groupId: NOTION_GROUP_ID,
  },
];
