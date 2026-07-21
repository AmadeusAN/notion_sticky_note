import type { ThemeId } from "./themes";
import type { FontId } from "./fonts";

export type { ThemeId } from "./themes";
export type { FontId } from "./fonts";

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
}

export interface NotionConfig {
  token: string;
  databaseId: string;
  doneProperty: string;
  titleProperty: string;
  dateProperty: string;
}

export interface AppSettings {
  theme: ThemeId;
  lightTheme: ThemeId;
  darkTheme: ThemeId;
  font: FontId;
  notion: NotionConfig;
}

export type SyncStatus = "idle" | "syncing" | "ok" | "error" | "offline";

export const MOCK_TASKS: Task[] = [
  {
    id: "local-1",
    notionId: null,
    title: "调研左心耳模型升级方案",
    completed: false,
    progress: "30%",
    remain: "2d",
    date: "2026-07-22",
    tags: ["research"],
    updatedTime: Date.now(),
  },
  {
    id: "local-2",
    notionId: null,
    title: "整理 Notion Database 字段映射",
    completed: true,
    progress: "100%",
    remain: "0d",
    date: "2026-07-18",
    tags: ["setup"],
    updatedTime: Date.now(),
  },
  {
    id: "local-3",
    notionId: null,
    title: "完善便签纸张纹理与阴影",
    completed: false,
    progress: "60%",
    remain: "1d",
    date: null,
    tags: ["ui"],
    updatedTime: Date.now(),
  },
];
