import { useLocale } from "../stores/languageStore";
import { useMemo, useRef, useState } from "react";
import { TaskGroups } from "./TaskGroups";
import { Composer } from "./Composer";
import { ConfirmDialog } from "./ConfirmDialog";
import { TaskEditorModal } from "./TaskEditorModal";
import { NoteEdgeEffects } from "./NoteEdgeEffects";
import { ReminderAlert } from "./ReminderAlert";
import { useTaskActions } from "./useTaskActions";
import type { DockSnapshot } from "../fx/types";
import { useTaskStore } from "../stores/taskStore";
import { useSettingsStore } from "../stores/settingsStore";
import { useModeStore } from "../stores/modeStore";
import { useToastStore } from "../stores/toastStore";
import { apiHideWindow } from "../services/tauriApi";

interface Props {
  onOpenSettings: () => void;
  onSwitchToWorkspace?: () => void;
  dock: DockSnapshot;
}

export function StickyNote({ onOpenSettings, onSwitchToWorkspace, dock }: Props) {
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
  const dockHandle = useSettingsStore((s) => s.dockHandle);
  const alwaysOnTop = useModeStore((s) => s.alwaysOnTop);
  const setMode = useModeStore((s) => s.setMode);
  const toggleAlwaysOnTop = useModeStore((s) => s.toggleAlwaysOnTop);
  const modeSwitching = useModeStore((s) => s.switching);
  const pushToast = useToastStore((s) => s.pushToast);

  const actions = useTaskActions();
  const [windowError, setWindowError] = useState<string | null>(null);
  const noteRef = useRef<HTMLDivElement>(null);
  const fallbackFocus = useRef<HTMLButtonElement>(null);

  const openCount = useMemo(() => tasks.reduce((count, task) => count + Number(!task.completed), 0), [tasks]);
  const statusClass = status === "syncing" ? "syncing" : status === "error" ? "error" : "";
  const dockClass =
    dock.phase !== "free" && dock.edge
      ? `dock-${dock.phase} dock-edge-${dock.edge} dock-handle-${dockHandle}`
      : `dock-handle-${dockHandle}`;

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
      <header className="note-header" data-tauri-drag-region inert={actions.modalOpen}>
        <h1 className="note-title" data-tauri-drag-region>{l.t("我的便签")}</h1>
        <div className="note-toolbar" role="toolbar" aria-label={l.t("便签操作")}>
          <button
            type="button"
            className="icon-btn icon-btn-new"
            ref={fallbackFocus}
            title={l.t("新建内容")}
            onClick={() => actions.openComposer(null)}
            aria-label={l.t("新建内容")}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
          </button>
          <button
            type="button"
            className="icon-btn"
            title={l.t("批量导入任务")}
            aria-label={l.t("批量导入任务")}
            onClick={() => actions.openComposer(null, "batch")}
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
            title={l.t("展开主面板")}
            aria-label={l.t("展开主面板")}
            disabled={modeSwitching}
            onClick={() => void (onSwitchToWorkspace ? onSwitchToWorkspace() : setMode("workspace"))}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <rect x="3" y="4" width="18" height="16" rx="2.5" />
              <path d="M9 4v16" />
            </svg>
          </button>
          <button
            type="button"
            className={`icon-btn${alwaysOnTop ? " is-pinned" : ""}`}
            aria-pressed={alwaysOnTop}
            title={alwaysOnTop ? l.t("取消置顶") : l.t("窗口置顶")}
            aria-label={alwaysOnTop ? l.t("取消置顶") : l.t("窗口置顶")}
            onClick={() =>
              void toggleAlwaysOnTop().then((pinned) =>
                pushToast(l.t(pinned ? "已置顶窗口" : "已取消置顶")),
              )
            }
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 17v5" />
              <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" />
            </svg>
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
      {windowError && <p className="msg error" role="alert" inert={actions.modalOpen}>{l.errorText(windowError)}</p>}
      {!actions.modalOpen && (
        <ReminderAlert
          reminders={actions.activeReminders}
          onComplete={actions.toggleTask}
          onInspect={actions.editTask}
        />
      )}
      {operationError && !actions.modalOpen && (
        <div className="msg error" role="alert">
          <span>{l.errorText(operationError.message)}</span>
          <button type="button" onClick={() => void operationError.retry().catch(() => {})}>{l.t("重试")}</button>
          <button type="button" onClick={dismissOperationError} aria-label={l.t("关闭操作错误提示")}>{l.t("关闭")}</button>
        </div>
      )}
      {status === "error" && syncState.error && (
        <p className="msg error" role="alert" inert={actions.modalOpen}>{l.errorText(syncState.error.message)}</p>
      )}

      <div className="task-list" inert={actions.modalOpen}>
        <TaskGroups
          onAddTasks={actions.addGroupTasks}
          onConfirmGroup={actions.confirmGroup}
          onConfirmTask={actions.confirmTask}
          onEditTask={actions.editTask}
        />
        <button
          type="button"
          className="add-group"
          onClick={() => actions.openComposer("new")}
        >
          {l.t("＋ 新建分组")}</button>
      </div>

      <footer className="note-footer" inert={actions.modalOpen}>
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

      {actions.composer && (
        <Composer
          groups={groups}
          pendingGroups={pendingGroups}
          defaultGroupId={actions.composer.groupId}
          mode={actions.composer.mode}
          initialSchedule={actions.composer.initialSchedule}
          onSubmit={actions.handleComposerSubmit}
          onCancel={() => actions.setComposer(null)}
          fallbackFocusRef={fallbackFocus}
        />
      )}
      {actions.removal && (
        <ConfirmDialog
          title={actions.removal.title}
          message={actions.removal.message}
          confirmLabel={actions.removal.label}
          onConfirm={actions.confirmRemoval}
          onCancel={() => actions.setConfirmation(null)}
          fallbackFocusRef={fallbackFocus}
        />
      )}
      {actions.editingTask && (
        <TaskEditorModal
          task={actions.editingTask}
          onSave={actions.updateTask}
          onCancel={() => actions.setEditingTaskId(null)}
          fallbackFocusRef={fallbackFocus}
        />
      )}

      <NoteEdgeEffects hostRef={noteRef} enabled={dock.presented && dock.phase !== "collapsed" && !actions.modalOpen} />
      <div className="dock-tab" aria-hidden data-tauri-drag-region />
      <div className="resize-handle" aria-hidden />
    </div>
  );
}
