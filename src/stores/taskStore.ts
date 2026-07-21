import { create } from "zustand";
import type { SyncStatus, Task } from "../types";
import {
  apiForceSync,
  apiGetTasks,
  apiToggleTask,
} from "../services/tauriApi";

interface TaskState {
  tasks: Task[];
  status: SyncStatus;
  lastError: string | null;
  lastSyncedAt: number | null;
  loadTasks: () => Promise<void>;
  toggleTask: (id: string) => Promise<void>;
  forceSync: () => Promise<void>;
  startPolling: () => void;
  stopPolling: () => void;
}

let pollTimer: ReturnType<typeof setInterval> | null = null;

export const useTaskStore = create<TaskState>((set, get) => ({
  tasks: [],
  status: "idle",
  lastError: null,
  lastSyncedAt: null,

  loadTasks: async () => {
    try {
      const tasks = await apiGetTasks();
      set({ tasks, status: "ok", lastError: null });
    } catch (e) {
      set({
        status: "error",
        lastError: e instanceof Error ? e.message : String(e),
      });
    }
  },

  toggleTask: async (id: string) => {
    const prev = get().tasks;
    set({
      tasks: prev.map((t) =>
        t.id === id
          ? { ...t, completed: !t.completed, updatedTime: Date.now() }
          : t,
      ),
    });
    try {
      const updated = await apiToggleTask(id);
      set({
        tasks: get().tasks.map((t) => (t.id === id ? updated : t)),
        lastError: null,
      });
    } catch (e) {
      set({
        tasks: prev,
        status: "error",
        lastError: e instanceof Error ? e.message : String(e),
      });
    }
  },

  forceSync: async () => {
    set({ status: "syncing" });
    try {
      await apiForceSync();
      const tasks = await apiGetTasks();
      set({
        tasks,
        status: "ok",
        lastError: null,
        lastSyncedAt: Date.now(),
      });
    } catch (e) {
      set({
        status: "error",
        lastError: e instanceof Error ? e.message : String(e),
      });
    }
  },

  startPolling: () => {
    if (pollTimer) return;
    pollTimer = setInterval(() => {
      void get().forceSync();
    }, 30_000);
  },

  stopPolling: () => {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  },
}));
