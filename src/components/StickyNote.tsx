import { useLocale } from "../stores/languageStore";
import { useCallback, useMemo, useRef, useState } from "react";
import { TaskGroups } from "./TaskGroups";
import { Composer } from "./Composer";
import { ConfirmDialog } from "./ConfirmDialog";
import { NoteEdgeEffects } from "./NoteEdgeEffects";
import type { DockSnapshot } from "../fx/types";
import { useTaskStore } from "../stores/taskStore";
import { useSettingsStore } from "../stores/settingsStore";
import type { Group, Task } from "../types";
import { apiHideWindow } from "../services/tauriApi";

interface Props {
  onOpenSettings: () => void;
  dock: DockSnapshot;
}


type Removal = { kind: "group"; group: Group } | { kind: "task"; task: Task };

export function StickyNote({ onOpenSettings, dock }: Props) {
  const l = useLocale();
  const tasks = useTaskStore((s) => s.tasks);
  const groups = useTaskStore((s) => s.groups);
  const syncState = useTaskStore((s) => s.syncState);
  const status = syncState.status;
  const operationError = useTaskStore((s) => s.operationError);
  const dismissOperationError = useTaskStore((s) => s.dismissOperationError);
  const syncRequestPending = useTaskStore((s) => s.syncRequestPending);
  const pendingGroups = useTaskStore((s) => s.pendingGroups);
  const forceSync = useTaskStore((s) => s.forceSync);
  const createGroup = useTaskStore((s) => s.createGroup);
  const deleteGroup = useTaskStore((s) => s.deleteGroup);
  const deleteTask = useTaskStore((s) => s.deleteTask);
  const importTasks = useTaskStore((s) => s.importTasks);
  const clearArchive = useTaskStore((s) => s.clearArchive);
  const dockHandle = useSettingsStore((s) => s.dockHandle);
  const [composer, setComposer] = useState<{ groupId: string | null; mode: "single" | "batch" } | null>(
    null,
  );
  const [confirmation, setConfirmation] = useState<Removal | null>(null);
  const [windowError, setWindowError] = useState<string | null>(null);
  const noteRef = useRef<HTMLDivElement>(null);
  const fallbackFocus = useRef<HTMLButtonElement>(null);
  const modalOpen = Boolean(composer || confirmation);



  const openCount = useMemo(() => tasks.reduce((count, task) => count + Number(!task.completed), 0), [tasks]);

  const statusClass =
    status === "syncing" ? "syncing" : status === "error" ? "error" : "";

  const dockClass =
    dock.phase !== "free" && dock.edge
      ? `dock-${dock.phase} dock-edge-${dock.edge} dock-handle-${dockHandle}`
      : `dock-handle-${dockHandle}`;


  const openComposer = (groupId: string | null, mode: "single" | "batch" = "single") =>
    setComposer({ groupId, mode });

  const addGroupTasks = useCallback((groupId: string) => setComposer({ groupId, mode: "single" }), []);
  const confirmGroup = useCallback((group: Group) => setConfirmation({ kind: "group", group }), []);
  const confirmTask = useCallback((task: Task) => setConfirmation({ kind: "task", task }), []);

  const handleComposerSubmit = async (p: {
    titles: string[];
    groupId: string | null;
    newGroupName: string | null;
  }) => {
    if (p.titles.length > 0) {
      await importTasks(p.titles, p.groupId, p.newGroupName);
    } else if (p.newGroupName && !p.groupId) {
      await createGroup(p.newGroupName);
    } else {
      throw new Error(l.t("请填写任务或新分组名称"));
    }
    setComposer(null);
  };

  const confirmRemoval = async () => {
    if (!confirmation) return;
    if (confirmation.kind === "task") await deleteTask(confirmation.task.id);
    else if (confirmation.group.kind === "archive") await clearArchive();
    else await deleteGroup(confirmation.group.id);
    setConfirmation(null);
  };
  const removalCount = confirmation?.kind === "group"
    ? tasks.reduce((count, task) => count + (task.groupId === confirmation.group.id ? 1 : 0), 0)
    : 0;
  const removal = confirmation && (confirmation.kind === "task" ? {
    title: l.t("删除任务"),
    message: l.t("永久删除「{title}」？此操作无法撤销。", { title: confirmation.task.title }),
    label: l.t("永久删除"),
  } : confirmation.group.kind === "archive" ? {
    title: l.t("清空归档"),
    message: l.t("永久清空 {count} 条归档任务？此操作无法撤销，Notion 任务不受影响。", { count: removalCount }),
    label: l.t("清空归档"),
  } : {
    title: l.t("删除分组"),
    message: l.t("删除「{name}」及其中的 {count} 条任务？此操作无法撤销。属于此分组的已归档任务会保留，但之后无法恢复回此分组。", { name: confirmation.group.name, count: removalCount }),
    label: l.t("删除分组"),
  });

  const handleHideWindow = async () => {
    setWindowError(null);
    try {
      await apiHideWindow();
    } catch (error) {
      setWindowError(error instanceof Error ? error.message : String(error));
    }
  };


  return (
    <div
      className={`sticky-note ${dockClass}`.trim()}
      ref={noteRef}
      data-dock-phase={dock.phase}
      data-dock-edge={dock.edge ?? ""}
    >
      <header className="note-header" data-tauri-drag-region inert={modalOpen}>
        <h1 className="note-title" data-tauri-drag-region>{l.t("我的便签")}</h1>
        <div className="note-toolbar" role="toolbar" aria-label={l.t("便签操作")}>
        <button
          type="button"
          className="icon-btn icon-btn-new"
          ref={fallbackFocus}
          title={l.t("新建内容")}
          onClick={() => openComposer(null)}
          aria-label={l.t("新建内容")}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
        </button>
        <button
          type="button"
          className="icon-btn"
          title={l.t("批量导入任务")}
          aria-label={l.t("批量导入任务")}
          onClick={() => openComposer(null, "batch")}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12m-4-4 4 4 4-4M4 15v5h16v-5" /></svg>
        </button>
        <button
          type="button"
          className="icon-btn"
          title={l.t("同步")}
          onClick={() => void forceSync()}
          aria-label={l.t("同步")}
          disabled={status === "syncing" || syncRequestPending}
          aria-busy={status === "syncing" || syncRequestPending}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 8a8 8 0 1 0 .4 7M20 3v5h-5" /></svg>
        </button>
        <button
          type="button"
          className="icon-btn"
          title={l.t("设置")}
          onClick={onOpenSettings}
          aria-label={l.t("设置")}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 3-.6 2.2-2 .9-2.1-.6L2 9l1.5 1.6v2.8L2 15l2.3 3.5 2.1-.6 2 .9L9 21h6l.6-2.2 2-.9 2.1.6L22 15l-1.5-1.6v-2.8L22 9l-2.3-3.5-2.1.6-2-.9L15 3Z" /><circle cx="12" cy="12" r="3" /></svg>
        </button>
        <button
          type="button"
          className="icon-btn"
          title={l.t("关闭窗口，保留在托盘")}
          aria-label={l.t("关闭到托盘")}
          disabled={!("__TAURI_INTERNALS__" in window)}
          onClick={() => void handleHideWindow()}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
        </button>
        </div>
      </header>
      {windowError && <p className="msg error" role="alert" inert={modalOpen}>{l.errorText(windowError)}</p>}
      {operationError && !modalOpen && (
        <div className="msg error" role="alert">
          <span>{l.errorText(operationError.message)}</span>
          <button type="button" onClick={() => void operationError.retry().catch(() => {})}>{l.t("重试")}</button>
          <button type="button" onClick={dismissOperationError} aria-label={l.t("关闭操作错误提示")}>{l.t("关闭")}</button>
        </div>
      )}
      {status === "error" && syncState.error && (
        <p className="msg error" role="alert" inert={modalOpen}>{l.errorText(syncState.error.message)}</p>
      )}

      <div className="task-list" inert={modalOpen}>
        <TaskGroups onAddTasks={addGroupTasks} onConfirmGroup={confirmGroup} onConfirmTask={confirmTask} />
        <button
          type="button"
          className="add-group"
          onClick={() => openComposer("new")}
        >
          {l.t("＋ 新建分组")}</button>
      </div>

      <footer className="note-footer" inert={modalOpen}>
        <span>
          <span className={`status-dot ${statusClass}`} />
          {status === "unconfigured" ? l.t("Notion 未配置")
            : status === "syncing" ? l.t("同步中…")
            : status === "error" ? l.t("同步失败")
            : syncState.lastSuccessfulAt === null ? l.t("尚未完成同步")
            : l.t("上次成功 {time}", { time: new Date(syncState.lastSuccessfulAt).toLocaleTimeString(l.locale, { hour: "2-digit", minute: "2-digit" }) })}
          {syncState.pendingCount > 0 && l.t(" · {count} 项待回写", { count: syncState.pendingCount })}
          {syncState.unresolvedCount > 0 && l.t("（{count} 项来源待确认）", { count: syncState.unresolvedCount })}
        </span>
        <span>
          {l.t("{count} 待办", { count: openCount })} · {l.t("{count} 组", { count: groups.length })} · {l.t("{count} 任务", { count: tasks.length })}
        </span>
      </footer>

      {composer && (
        <Composer
          groups={groups}
          pendingGroups={pendingGroups}
          defaultGroupId={composer.groupId}
          mode={composer.mode}
          onSubmit={handleComposerSubmit}
          onCancel={() => setComposer(null)}
          fallbackFocusRef={fallbackFocus}
        />
      )}
      {removal && (
        <ConfirmDialog
          title={removal.title}
          message={removal.message}
          confirmLabel={removal.label}
          onConfirm={confirmRemoval}
          onCancel={() => setConfirmation(null)}
          fallbackFocusRef={fallbackFocus}
        />
      )}

      <NoteEdgeEffects hostRef={noteRef} enabled={dock.presented && dock.phase !== "collapsed" && !modalOpen} />
      <div className="dock-tab" aria-hidden data-tauri-drag-region />
      <div className="resize-handle" aria-hidden />
    </div>
  );
}