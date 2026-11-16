import { create } from "zustand";
import type { Group, SyncState, Task, TaskView } from "../types";
import { ARCHIVE_GROUP_ID, NOTION_GROUP_ID } from "../types";
import {
  apiClearArchive, apiCreateGroup, apiDeleteGroup, apiDeleteTask, apiForceSync,
  apiGetSyncState, apiGetTaskView, apiImportTasks, apiListenSyncState, apiToggleTask,
} from "../services/tauriApi";

interface OperationError {
  key: string;
  message: string;
  retry: () => Promise<unknown>;
}

interface TaskState {
  tasks: Task[];
  groups: Group[];
  hydrated: boolean;
  refreshing: boolean;
  syncState: SyncState;
  syncRequestPending: boolean;
  operationError: OperationError | null;
  pendingTasks: Record<string, "toggle" | "delete">;
  pendingGroups: Record<string, "import" | "delete">;
  busyGroups: Record<string, number>;
  creatingGroup: boolean;
  clearingArchive: boolean;
  refreshTaskView: () => Promise<void>;
  applySyncState: (state: SyncState) => void;
  connectSyncState: () => () => void;
  dismissOperationError: () => void;
  createGroup: (name: string) => Promise<Group>;
  deleteGroup: (id: string) => Promise<void>;
  importTasks: (titles: string[], groupId: string | null, newGroupName: string | null) => Promise<void>;
  deleteTask: (id: string) => Promise<void>;
  toggleTask: (id: string) => Promise<void>;
  clearArchive: () => Promise<void>;
  forceSync: () => Promise<void>;
}

const initialSyncState: SyncState = {
  seq: 0, cycleId: 0, status: "unconfigured", lastSuccessfulAt: null,
  pendingCount: 0, unresolvedCount: 0, error: null, dataChanged: false,
};

function errMsg(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sameTask(a: Task, b: Task): boolean {
  return a.id === b.id && a.notionId === b.notionId && a.title === b.title &&
    a.completed === b.completed && a.progress === b.progress && a.remain === b.remain &&
    a.date === b.date && a.updatedTime === b.updatedTime && a.groupId === b.groupId &&
    a.tags.length === b.tags.length && a.tags.every((tag, index) => tag === b.tags[index]);
}

function sameGroup(a: Group, b: Group): boolean {
  return a.id === b.id && a.name === b.name && a.kind === b.kind &&
    a.position === b.position && a.createdAt === b.createdAt;
}

function reconcile<T extends { id: string }>(previous: T[], incoming: T[], same: (a: T, b: T) => boolean): T[] {
  const byId = new Map(previous.map((item) => [item.id, item]));
  const next = incoming.map((item) => {
    const old = byId.get(item.id);
    return old && same(old, item) ? old : item;
  });
  return next.length === previous.length && next.every((item, index) => item === previous[index]) ? previous : next;
}

function orderedTasks(tasks: Task[]): Task[] {
  return tasks.sort((a, b) => Number(a.completed) - Number(b.completed) || b.updatedTime - a.updatedTime);
}

export function createTaskStore() {
  return create<TaskState>((set, get) => {
    let requestNumber = 0;
    let mutationEpoch = 0;
    let activeMutations = 0;
    let refreshNeeded = false;
    let readPromise: Promise<void> | null = null;
    let lastSyncSeq = -1;

    const report = (key: string, error: unknown, retry: () => Promise<unknown>) =>
      set({ operationError: { key, message: errMsg(error), retry } });
    const clearError = (key: string) => {
      if (get().operationError?.key === key) set({ operationError: null });
    };
    const begin = (key: string, groups: string[]) => {
      activeMutations++;
      mutationEpoch++;
      clearError(key);
      set((state) => {
        const busyGroups = { ...state.busyGroups };
        for (const group of groups) busyGroups[group] = (busyGroups[group] ?? 0) + 1;
        return { busyGroups };
      });
    };
    const end = (groups: string[]) => {
      activeMutations--;
      mutationEpoch++;
      set((state) => {
        const busyGroups = { ...state.busyGroups };
        for (const group of groups) {
          if (busyGroups[group] > 1) busyGroups[group]--;
          else delete busyGroups[group];
        }
        return { busyGroups };
      });
      if (refreshNeeded && activeMutations === 0) void get().refreshTaskView();
    };
    const writable = (group: string) => {
      if (get().pendingGroups[group] === "delete") throw new Error("分组正在删除，请等待操作完成");
    };
    const finishTask = (id: string) => set((state) => {
      const pendingTasks = { ...state.pendingTasks };
      delete pendingTasks[id];
      return { pendingTasks };
    });
    const finishGroup = (id: string) => set((state) => {
      const pendingGroups = { ...state.pendingGroups };
      delete pendingGroups[id];
      return { pendingGroups };
    });

    return {
      tasks: [], groups: [], hydrated: false, refreshing: false,
      syncState: { ...initialSyncState }, syncRequestPending: false, operationError: null,
      pendingTasks: {}, pendingGroups: {}, busyGroups: {}, creatingGroup: false, clearingArchive: false,

      refreshTaskView: () => {
        refreshNeeded = true;
        if (activeMutations > 0 || readPromise) return readPromise ?? Promise.resolve();
        set({ refreshing: true });
        readPromise = (async () => {
          while (refreshNeeded && activeMutations === 0) {
            refreshNeeded = false;
            const request = ++requestNumber;
            const epoch = mutationEpoch;
            try {
              const view: TaskView = await apiGetTaskView();
              if (request !== requestNumber || epoch !== mutationEpoch || activeMutations > 0) {
                refreshNeeded = true;
                continue;
              }
              set((state) => ({
                tasks: reconcile(state.tasks, view.tasks, sameTask),
                groups: reconcile(state.groups, view.groups, sameGroup),
                hydrated: true,
              }));
              clearError("refresh");
            } catch (error) {
              if (epoch !== mutationEpoch || activeMutations > 0) refreshNeeded = true;
              else report("refresh", error, () => get().refreshTaskView());
            }
          }
        })().finally(() => {
          readPromise = null;
          set({ refreshing: false });
          if (refreshNeeded && activeMutations === 0) void get().refreshTaskView();
        });
        return readPromise;
      },

      applySyncState: (syncState) => {
        if (syncState.seq <= lastSyncSeq) return;
        lastSyncSeq = syncState.seq;
        set({ syncState });
        if (syncState.dataChanged) void get().refreshTaskView();
      },

      connectSyncState: () => {
        let alive = true;
        let generation = 0;
        let unlisten: (() => void) | null = null;
        const attach = async () => {
          if (!alive) return;
          const current = ++generation;
          unlisten?.();
          unlisten = null;
          try {
            const cleanup = await apiListenSyncState((state) => {
              if (alive && generation === current) get().applySyncState(state);
            });
            if (!alive || generation !== current) { cleanup(); return; }
            unlisten = cleanup;
            const state = await apiGetSyncState();
            if (alive && generation === current) {
              get().applySyncState(state);
              clearError("sync-state");
            }
          } catch (error) {
            if (alive && generation === current) report("sync-state", error, attach);
          }
        };
        void attach();
        return () => { alive = false; generation++; unlisten?.(); unlisten = null; };
      },

      dismissOperationError: () => set({ operationError: null }),

      createGroup: async (name) => {
        if (get().creatingGroup) throw new Error("正在创建分组");
        const key = "create-group";
        set({ creatingGroup: true });
        begin(key, []);
        try {
          const group = await apiCreateGroup(name.trim());
          set((state) => ({ groups: [...state.groups, group] }));
          return group;
        } catch (error) { report(key, error, () => get().createGroup(name)); throw error; }
        finally { set({ creatingGroup: false }); end([]); }
      },

      importTasks: async (titles, groupId, newGroupName) => {
        if (groupId) writable(groupId);
        if (groupId ? get().pendingGroups[groupId] : get().creatingGroup) throw new Error("正在向该分组添加任务");
        const groupIds = groupId ? [groupId] : [];
        const key = `import:${groupId ?? "new"}`;
        const submittedTitles = [...titles];
        if (groupId) set((state) => ({ pendingGroups: { ...state.pendingGroups, [groupId]: "import" } }));
        else set({ creatingGroup: true });
        begin(key, groupIds);
        try {
          const result = await apiImportTasks(submittedTitles, groupId, newGroupName);
          set((state) => ({
            tasks: orderedTasks([...state.tasks, ...result.tasks]),
            groups: state.groups.some((group) => group.id === result.group.id) ? state.groups : [...state.groups, result.group],
          }));
        } catch (error) {
          report(key, error, () => get().importTasks(submittedTitles, groupId, newGroupName));
          throw error;
        } finally {
          if (groupId) finishGroup(groupId);
          else set({ creatingGroup: false });
          end(groupIds);
        }
      },

      deleteGroup: async (id) => {
        if (get().busyGroups[id]) throw new Error("分组有正在进行的操作");
        const key = `delete-group:${id}`;
        set((state) => ({ pendingGroups: { ...state.pendingGroups, [id]: "delete" } }));
        begin(key, [id]);
        try {
          const removed = new Set(await apiDeleteGroup(id));
          set((state) => ({
            groups: state.groups.filter((group) => group.id !== id),
            tasks: state.tasks.filter((task) => !removed.has(task.id)),
          }));
        } catch (error) { report(key, error, () => get().deleteGroup(id)); throw error; }
        finally { finishGroup(id); end([id]); }
      },

      deleteTask: async (id) => {
        if (get().pendingTasks[id]) return;
        const task = get().tasks.find((task) => task.id === id);
        if (!task) return;
        writable(task.groupId);
        if (task.groupId === ARCHIVE_GROUP_ID && get().clearingArchive) return;
        const key = `delete-task:${id}`;
        set((state) => ({ pendingTasks: { ...state.pendingTasks, [id]: "delete" } }));
        begin(key, [task.groupId]);
        try {
          await apiDeleteTask(id);
          set((state) => ({ tasks: state.tasks.filter((task) => task.id !== id) }));
        } catch (error) { report(key, error, () => get().deleteTask(id)); throw error; }
        finally { finishTask(id); end([task.groupId]); }
      },

      toggleTask: async (id) => {
        if (get().pendingTasks[id]) return;
        const previous = get().tasks.find((task) => task.id === id);
        if (!previous) return;
        const key = `toggle:${id}`;
        try { writable(previous.groupId); }
        catch (error) { report(key, error, () => get().toggleTask(id)); return; }
        const notion = Boolean(previous.notionId || previous.groupId === NOTION_GROUP_ID);
        if (!notion && get().clearingArchive) return;
        const groupIds = notion || previous.groupId === ARCHIVE_GROUP_ID ? [previous.groupId] : [previous.groupId, ARCHIVE_GROUP_ID];
        const optimistic = notion ? { ...previous, completed: !previous.completed } : previous;
        set((state) => ({
          pendingTasks: { ...state.pendingTasks, [id]: "toggle" },
          tasks: notion ? state.tasks.map((task) => task.id === id ? optimistic : task) : state.tasks,
        }));
        begin(key, groupIds);
        try {
          const updated = await apiToggleTask(id);
          set((state) => ({ tasks: orderedTasks(state.tasks.map((task) => task.id === id ? updated : task)) }));
        } catch (error) {
          if (notion) set((state) => ({ tasks: state.tasks.map((task) => task === optimistic ? previous : task) }));
          report(key, error, () => get().toggleTask(id));
        } finally { finishTask(id); end(groupIds); }
      },

      clearArchive: async () => {
        if (get().clearingArchive || get().busyGroups[ARCHIVE_GROUP_ID]) return;
        const key = "clear-archive";
        set({ clearingArchive: true });
        begin(key, [ARCHIVE_GROUP_ID]);
        try {
          const removed = new Set(await apiClearArchive());
          set((state) => ({ tasks: state.tasks.filter((task) => !removed.has(task.id)) }));
        } catch (error) { report(key, error, () => get().clearArchive()); throw error; }
        finally { set({ clearingArchive: false }); end([ARCHIVE_GROUP_ID]); }
      },

      forceSync: async () => {
        if (get().syncRequestPending) return;
        set({ syncRequestPending: true });
        clearError("sync");
        try { get().applySyncState(await apiForceSync()); }
        catch (error) { report("sync", error, () => get().forceSync()); }
        finally { set({ syncRequestPending: false }); }
      },
    };
  });
}

export const useTaskStore = createTaskStore();