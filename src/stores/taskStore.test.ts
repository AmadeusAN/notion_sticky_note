import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Group, SyncState, Task, TaskView } from "../types";

vi.mock("../services/tauriApi", () => ({
  apiClearArchive: vi.fn(), apiCreateGroup: vi.fn(), apiDeleteGroup: vi.fn(),
  apiDeleteTask: vi.fn(), apiForceSync: vi.fn(), apiGetSyncState: vi.fn(),
  apiGetTaskView: vi.fn(), apiImportTasks: vi.fn(), apiListenSyncState: vi.fn(),
  apiReorderGroups: vi.fn(), apiReorderTasks: vi.fn(), apiToggleTask: vi.fn(),
}));
import * as api from "../services/tauriApi";
import { createTaskStore } from "./taskStore";

const group: Group = { id: "local", name: "Local", kind: "local", position: 1, createdAt: 1 };
const otherGroup: Group = { ...group, id: "other", name: "Other", position: 2 };
const archive: Group = { ...group, id: "archive", name: "Archive", kind: "archive" };
const task: Task = { id: "one", notionId: null, title: "One", completed: false, progress: null,
  remain: null, date: null, tags: [], updatedTime: 1, groupId: group.id };
const remote: Task = { ...task, id: "remote", notionId: "remote", groupId: "notion" };
const added: Task = { ...task, id: "new", title: "Saved new task", updatedTime: 2 };
const archived: Task = { ...task, id: "archived", completed: true, groupId: "archive" };
const view = (tasks = [task], groups = [group, otherGroup, archive]): TaskView => ({ tasks, groups });
const sync = (seq: number, patch: Partial<SyncState> = {}): SyncState => ({
  seq, cycleId: 1, status: "unconfigured", lastSuccessfulAt: null, pendingCount: 0,
  unresolvedCount: 0, error: null, dataChanged: false, ...patch,
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
let store: ReturnType<typeof createTaskStore>;
beforeEach(() => {
  vi.resetAllMocks();
  store = createTaskStore();
  store.setState(view());
  vi.mocked(api.apiGetTaskView).mockResolvedValue(view());
  vi.mocked(api.apiGetSyncState).mockResolvedValue(sync(0));
  vi.mocked(api.apiListenSyncState).mockResolvedValue(() => {});
  vi.mocked(api.apiCreateGroup).mockResolvedValue({ ...group, id: "created", name: "Created" });
  vi.mocked(api.apiImportTasks).mockResolvedValue({ group, tasks: [added] });
  vi.mocked(api.apiDeleteGroup).mockResolvedValue([task.id]);
  vi.mocked(api.apiDeleteTask).mockResolvedValue();
  vi.mocked(api.apiClearArchive).mockResolvedValue([archived.id]);
  vi.mocked(api.apiReorderGroups).mockResolvedValue(null);
  vi.mocked(api.apiReorderTasks).mockResolvedValue(null);
});

describe("coherent task views", () => {
  it("rejects a stale read across an import and coalesces the follow-up refresh", async () => {
    const oldRead = deferred<TaskView>();
    const imported = deferred<{ group: Group; tasks: Task[] }>();
    const latest = deferred<TaskView>();
    vi.mocked(api.apiGetTaskView).mockReturnValueOnce(oldRead.promise).mockReturnValueOnce(latest.promise);
    vi.mocked(api.apiImportTasks).mockReturnValueOnce(imported.promise);
    const reading = store.getState().refreshTaskView();
    const saving = store.getState().importTasks([added.title], group.id, null);
    oldRead.resolve(view());
    await oldRead.promise;
    expect(store.getState().pendingGroups[group.id]).toBe("import");
    imported.resolve({ group, tasks: [added] });
    await saving;
    expect(store.getState().tasks.some((value) => value.id === added.id)).toBe(true);
    latest.resolve(view([added, task]));
    await reading;
    await latest.promise;
    expect(store.getState().tasks.map((value) => value.id)).toEqual([added.id, task.id]);
    expect(api.apiGetTaskView).toHaveBeenCalledTimes(2);
  });

  it("does not let an old view undo a committed group creation", async () => {
    const old = deferred<TaskView>();
    const latest = deferred<TaskView>();
    vi.mocked(api.apiGetTaskView).mockReturnValueOnce(old.promise).mockReturnValueOnce(latest.promise);
    const reading = store.getState().refreshTaskView();
    const created = await store.getState().createGroup("Created");
    old.resolve(view());
    await old.promise;
    expect(store.getState().groups.some((value) => value.id === created.id)).toBe(true);
    latest.resolve(view([task], [...view().groups, created]));
    await reading;
    expect(store.getState().groups.some((value) => value.id === created.id)).toBe(true);
  });

  it("uses actual deleted IDs and keeps already archived tasks when a group is deleted", async () => {
    store.setState(view([task, archived]));
    await store.getState().deleteGroup(group.id);
    expect(store.getState().groups.some((value) => value.id === group.id)).toBe(false);
    expect(store.getState().tasks).toEqual([archived]);
    vi.mocked(api.apiGetTaskView).mockRejectedValueOnce(new Error("read unavailable"));
    await store.getState().refreshTaskView();
    expect(store.getState().tasks).toEqual([archived]);
    expect(store.getState().operationError?.key).toBe("refresh");
  });

  it("never treats a later read failure as a failed import or retries the committed import", async () => {
    await expect(store.getState().importTasks([added.title], group.id, null)).resolves.toBeUndefined();
    vi.mocked(api.apiGetTaskView).mockRejectedValueOnce(new Error("read unavailable"));
    await store.getState().refreshTaskView();
    expect(store.getState().tasks.some((value) => value.id === added.id)).toBe(true);
    vi.mocked(api.apiGetTaskView).mockResolvedValueOnce(view([added, task]));
    await store.getState().operationError?.retry();
    expect(api.apiImportTasks).toHaveBeenCalledTimes(1);
    expect(store.getState().tasks.some((value) => value.id === added.id)).toBe(true);
  });

  it("coalesces sync notifications arriving during a mutation into one deferred view request", async () => {
    const imported = deferred<{ group: Group; tasks: Task[] }>();
    vi.mocked(api.apiImportTasks).mockReturnValueOnce(imported.promise);
    vi.mocked(api.apiGetTaskView).mockResolvedValue(view([added, task]));
    const saving = store.getState().importTasks([added.title], group.id, null);
    for (let seq = 1; seq <= 20; seq++) store.getState().applySyncState(sync(seq, { status: "ok", dataChanged: true }));
    expect(api.apiGetTaskView).not.toHaveBeenCalled();
    imported.resolve({ group, tasks: [added] });
    await saving;
    expect(api.apiGetTaskView).toHaveBeenCalledTimes(1);
    expect(store.getState().tasks.some((value) => value.id === added.id)).toBe(true);
  });
});

describe("pending operations", () => {
  it("prevents duplicate toggles and commits local completion and Archive membership together", async () => {
    const toggled = deferred<Task>();
    vi.mocked(api.apiToggleTask).mockReturnValueOnce(toggled.promise);
    const first = store.getState().toggleTask(task.id);
    await store.getState().toggleTask(task.id);
    expect(api.apiToggleTask).toHaveBeenCalledTimes(1);
    expect(store.getState().tasks[0]).toEqual(task);
    expect(store.getState().pendingTasks[task.id]).toBe("toggle");
    toggled.resolve({ ...task, completed: true, groupId: "archive", updatedTime: 2 });
    await first;
    expect(store.getState().tasks[0].completed).toBe(true);
    expect(store.getState().tasks[0].groupId).toBe("archive");
    expect(store.getState().pendingTasks[task.id]).toBeUndefined();
  });

  it("keeps an archived task unchanged when its original group no longer exists", async () => {
    store.setState(view([archived]));
    vi.mocked(api.apiToggleTask).mockRejectedValueOnce(new Error("原分组已删除"));
    await store.getState().toggleTask(archived.id);
    expect(store.getState().tasks[0]).toEqual(archived);
    expect(store.getState().operationError?.message).toBe("原分组已删除");
  });

  it("rolls back only the failing Notion checkbox, never a concurrent successful import", async () => {
    store.setState(view([remote, task]));
    const toggled = deferred<Task>();
    vi.mocked(api.apiToggleTask).mockReturnValueOnce(toggled.promise);
    const toggling = store.getState().toggleTask(remote.id);
    expect(store.getState().tasks.find((value) => value.id === remote.id)?.completed).toBe(true);
    await store.getState().importTasks([added.title], group.id, null);
    toggled.reject(new Error("transaction rejected"));
    await toggling;
    expect(store.getState().tasks.find((value) => value.id === remote.id)?.completed).toBe(false);
    expect(store.getState().tasks.some((value) => value.id === added.id)).toBe(true);
    expect(store.getState().operationError?.key).toBe(`toggle:${remote.id}`);
  });

  it("blocks writes into a deleting group while an unrelated group remains usable", async () => {
    const deleted = deferred<string[]>();
    vi.mocked(api.apiDeleteGroup).mockReturnValueOnce(deleted.promise);
    const deleting = store.getState().deleteGroup(group.id);
    await expect(store.getState().importTasks(["blocked"], group.id, null)).rejects.toThrow("删除");
    await store.getState().toggleTask(task.id);
    expect(api.apiToggleTask).not.toHaveBeenCalled();
    const otherTask = { ...added, groupId: otherGroup.id };
    vi.mocked(api.apiImportTasks).mockResolvedValueOnce({ group: otherGroup, tasks: [otherTask] });
    await store.getState().importTasks([added.title], otherGroup.id, null);
    deleted.resolve([task.id]);
    await deleting;
    expect(store.getState().tasks).toEqual([otherTask]);
  });

  it("clears only returned Archive IDs and blocks duplicate Archive submissions", async () => {
    store.setState(view([task, remote, archived]));
    const cleared = deferred<string[]>();
    vi.mocked(api.apiClearArchive).mockReturnValueOnce(cleared.promise);
    const clearing = store.getState().clearArchive();
    await store.getState().clearArchive();
    await store.getState().toggleTask(archived.id);
    expect(api.apiClearArchive).toHaveBeenCalledTimes(1);
    expect(api.apiToggleTask).not.toHaveBeenCalled();
    cleared.resolve([archived.id]);
    await clearing;
    expect(store.getState().tasks.map((value) => value.id)).toEqual([task.id, remote.id]);
  });
});

describe("authoritative sync state", () => {
  it("does not turn successful local reads into successful remote sync or erase operation errors", async () => {
    vi.mocked(api.apiImportTasks).mockRejectedValueOnce(new Error("save rejected"));
    await expect(store.getState().importTasks(["x"], group.id, null)).rejects.toThrow();
    await store.getState().refreshTaskView();
    expect(store.getState().syncState.status).toBe("unconfigured");
    expect(store.getState().syncState.lastSuccessfulAt).toBeNull();
    expect(store.getState().operationError?.message).toBe("save rejected");
    store.getState().applySyncState(sync(5, { status: "ok", lastSuccessfulAt: 1234 }));
    expect(store.getState().operationError?.message).toBe("save rejected");
    expect(store.getState().syncState.lastSuccessfulAt).toBe(1234);
  });

  it("discards old and duplicate seq values and requests views only for changed data", async () => {
    const changed = deferred<TaskView>();
    vi.mocked(api.apiGetTaskView).mockReturnValueOnce(changed.promise);
    store.getState().applySyncState(sync(3, { status: "syncing" }));
    store.getState().applySyncState(sync(2, { status: "ok", lastSuccessfulAt: 1000 }));
    expect(store.getState().syncState.status).toBe("syncing");
    expect(api.apiGetTaskView).not.toHaveBeenCalled();
    const latest = sync(4, { status: "ok", lastSuccessfulAt: 2000, dataChanged: true });
    store.getState().applySyncState(latest);
    store.getState().applySyncState(latest);
    changed.resolve(view([added, task]));
    await changed.promise;
    expect(api.apiGetTaskView).toHaveBeenCalledTimes(1);
    expect(store.getState().syncState.lastSuccessfulAt).toBe(2000);
    expect(store.getState().tasks[0].id).toBe(added.id);
  });

  it("registers the listener before reading state and ignores an older readback", async () => {
    const registration = deferred<() => void>();
    const readback = deferred<SyncState>();
    const unlisten = vi.fn();
    vi.mocked(api.apiListenSyncState).mockReturnValueOnce(registration.promise);
    vi.mocked(api.apiGetSyncState).mockReturnValueOnce(readback.promise);
    const disconnect = store.getState().connectSyncState();
    expect(api.apiGetSyncState).not.toHaveBeenCalled();
    const listener = vi.mocked(api.apiListenSyncState).mock.calls[0][0];
    listener(sync(8, { status: "syncing" }));
    registration.resolve(unlisten);
    await registration.promise;
    expect(api.apiGetSyncState).toHaveBeenCalledTimes(1);
    readback.resolve(sync(7, { status: "ok", lastSuccessfulAt: 10 }));
    await readback.promise;
    expect(store.getState().syncState.seq).toBe(8);
    disconnect();
    listener(sync(9, { status: "ok" }));
    expect(store.getState().syncState.seq).toBe(8);
    expect(unlisten).toHaveBeenCalledTimes(1);
  });

  it("immediately cleans up a subscription that completes after unmount", async () => {
    const registration = deferred<() => void>();
    const unlisten = vi.fn();
    vi.mocked(api.apiListenSyncState).mockReturnValueOnce(registration.promise);
    const disconnect = store.getState().connectSyncState();
    disconnect();
    registration.resolve(unlisten);
    await registration.promise;
    expect(unlisten).toHaveBeenCalledTimes(1);
    expect(api.apiGetSyncState).not.toHaveBeenCalled();
  });

  it("waits for the manual round's real error result rather than manufacturing success", async () => {
    const result = deferred<SyncState>();
    vi.mocked(api.apiForceSync).mockReturnValueOnce(result.promise);
    const first = store.getState().forceSync();
    await store.getState().forceSync();
    expect(store.getState().syncRequestPending).toBe(true);
    result.resolve(sync(1, { status: "error", pendingCount: 2,
      error: { category: "authentication", message: "更新凭据", status: 401, code: "unauthorized", retryAfterMs: null } }));
    await first;
    expect(store.getState().syncState.status).toBe("error");
    expect(store.getState().syncState.pendingCount).toBe(2);
    expect(store.getState().syncState.lastSuccessfulAt).toBeNull();
    expect(store.getState().syncRequestPending).toBe(false);
    expect(api.apiForceSync).toHaveBeenCalledTimes(1);
  });

  it("optimistically reorders custom groups and tasks and rolls back on failure", async () => {
    const secondTask: Task = { ...task, id: "two", title: "Two", updatedTime: 2 };
    store.setState(view([task, secondTask], [group, otherGroup, archive]));

    const pendingGroups = deferred<Group[] | null>();
    vi.mocked(api.apiReorderGroups).mockReturnValueOnce(pendingGroups.promise);
    const groupReorder = store.getState().reorderGroups([otherGroup.id, group.id]);
    expect(store.getState().groups.map((g) => g.id)).toEqual([otherGroup.id, group.id, archive.id]);
    pendingGroups.reject(new Error("排序保存失败"));
    await expect(groupReorder).rejects.toThrow("排序保存失败");
    expect(store.getState().groups.map((g) => g.id)).toEqual([group.id, otherGroup.id, archive.id]);
    expect(store.getState().operationError?.message).toBe("排序保存失败");

    const pendingTasks = deferred<Task[] | null>();
    vi.mocked(api.apiReorderTasks).mockReturnValueOnce(pendingTasks.promise);
    const taskReorder = store.getState().reorderTasks(group.id, [task.id, secondTask.id]);
    expect(store.getState().tasks.map((t) => t.id)).toEqual([task.id, secondTask.id]);
    pendingTasks.resolve([
      { ...task, position: 1 },
      { ...secondTask, position: 2 },
    ]);
    await taskReorder;
    expect(store.getState().tasks.map((t) => [t.id, t.position])).toEqual([
      [task.id, 1],
      [secondTask.id, 2],
    ]);
  });
});
