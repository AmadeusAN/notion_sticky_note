import { useMemo, useRef, useState } from "react";
import { useLocale } from "../stores/languageStore";
import { useTaskStore } from "../stores/taskStore";
import { useModeStore } from "../stores/modeStore";
import { useToastStore } from "../stores/toastStore";
import { TaskGroups } from "./TaskGroups";
import { HomeView } from "./HomeView";
import { CalendarView } from "./CalendarView";
import { BoardView } from "./BoardView";
import { TaskInspector } from "./TaskInspector";
import { Composer } from "./Composer";
import { ConfirmDialog } from "./ConfirmDialog";
import { ReminderAlert } from "./ReminderAlert";
import { useTaskActions } from "./useTaskActions";
import { apiHideWindow } from "../services/tauriApi";
import { resolveAppIconDataUrl } from "../services/appIcons";
import { todayIso } from "../services/taskDate";

type WorkspaceView = "calendar" | "list" | "board";

interface Props {
  onOpenSettings: () => void;
}

export function WorkspaceShell({ onOpenSettings }: Props) {
  const l = useLocale();
  const tasks = useTaskStore((s) => s.tasks);
  const groups = useTaskStore((s) => s.groups);
  const syncState = useTaskStore((s) => s.syncState);
  const status = syncState.status;
  const syncRequestPending = useTaskStore((s) => s.syncRequestPending);
  const operationError = useTaskStore((s) => s.operationError);
  const dismissOperationError = useTaskStore((s) => s.dismissOperationError);
  const pendingGroups = useTaskStore((s) => s.pendingGroups);
  const forceSync = useTaskStore((s) => s.forceSync);

  const maximized = useModeStore((s) => s.maximized);
  const alwaysOnTop = useModeStore((s) => s.alwaysOnTop);
  const appIconId = useModeStore((s) => s.appIconId);
  const customIconDataUrl = useModeStore((s) => s.customIconDataUrl);
  const switching = useModeStore((s) => s.switching);
  const modeError = useModeStore((s) => s.error);
  const clearModeError = useModeStore((s) => s.clearError);
  const setMode = useModeStore((s) => s.setMode);
  const toggleAlwaysOnTop = useModeStore((s) => s.toggleAlwaysOnTop);
  const minimize = useModeStore((s) => s.minimize);
  const toggleMaximize = useModeStore((s) => s.toggleMaximize);
  const pushToast = useToastStore((s) => s.pushToast);

  const actions = useTaskActions();
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [isHomePage, setIsHomePage] = useState(true);
  const [activeView, setActiveView] = useState<WorkspaceView>("calendar");
  const [calendarFocusDayIso, setCalendarFocusDayIso] = useState<string | null>(null);
  const [inspectedTaskId, setInspectedTaskId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [windowError, setWindowError] = useState<string | null>(null);
  const fallbackFocus = useRef<HTMLButtonElement>(null);

  const orderedGroups = useMemo(() => {
    const rank = (kind: string) => (kind === "notion" ? 0 : kind === "archive" ? 2 : 1);
    return [...groups].sort((a, b) => rank(a.kind) - rank(b.kind) || a.position - b.position);
  }, [groups]);

  const countsByGroup = useMemo(() => {
    const map = new Map<string, number>();
    for (const task of tasks) {
      map.set(task.groupId, (map.get(task.groupId) ?? 0) + 1);
    }
    return map;
  }, [tasks]);

  const filteredTasks = useMemo(
    () => (selectedGroupId ? tasks.filter((t) => t.groupId === selectedGroupId) : tasks),
    [tasks, selectedGroupId],
  );
  const filteredGroups = useMemo(
    () => (selectedGroupId ? groups.filter((g) => g.id === selectedGroupId) : groups),
    [groups, selectedGroupId],
  );

  const inspectedTask = useMemo(
    () => (inspectedTaskId ? tasks.find((t) => t.id === inspectedTaskId) ?? null : null),
    [inspectedTaskId, tasks],
  );

  const openCount = useMemo(() => tasks.reduce((acc, t) => acc + Number(!t.completed), 0), [tasks]);

  const selectedGroup = useMemo(
    () => (selectedGroupId ? groups.find((g) => g.id === selectedGroupId) ?? null : null),
    [groups, selectedGroupId],
  );
  const activeHeading = !selectedGroup
    ? l.t("全部任务")
    : selectedGroup.kind === "notion"
      ? l.t("来自 Notion")
      : selectedGroup.kind === "archive"
        ? l.t("归档")
        : selectedGroup.name;

  const statusClass = status === "syncing" ? "syncing" : status === "error" ? "error" : "";
  const isTauri = "__TAURI_INTERNALS__" in window;

  const handleHide = async () => {
    setWindowError(null);
    try {
      await apiHideWindow();
    } catch (error) {
      setWindowError(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <div className="workspace-shell">
      <header className="workspace-titlebar" data-tauri-drag-region inert={actions.modalOpen}>
        <div className="workspace-titlebar-left" data-tauri-drag-region>
          <button
            type="button"
            className="icon-btn"
            aria-label={l.t("切换侧边栏")}
            title={l.t("切换侧边栏")}
            onClick={() => setSidebarOpen((v) => !v)}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <rect x="3" y="4" width="18" height="16" rx="2.5" />
              <path d="M9 4v16" />
            </svg>
          </button>
          <img
            className="workspace-brand-icon"
            src={resolveAppIconDataUrl(appIconId, customIconDataUrl)}
            alt=""
            aria-hidden="true"
            data-tauri-drag-region
          />
          <span className="workspace-brand" data-tauri-drag-region>
            {l.t("Sticky Note 工作台")}
          </span>
        </div>

        <nav className="workspace-view-tabs" aria-label={l.t("工作台视图")}>
          {(
            [
              ["calendar", l.t("日历视图")],
              ["list", l.t("清单视图")],
              ["board", l.t("看板视图")],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={`workspace-tab${!isHomePage && activeView === id ? " active" : ""}`}
              aria-pressed={!isHomePage && activeView === id}
              onClick={() => {
                setIsHomePage(false);
                setActiveView(id);
              }}
            >
              {label}
            </button>
          ))}
        </nav>

        <div className="workspace-titlebar-right">
          <button
            type="button"
            className="workspace-sync-pill"
            title={l.t("同步")}
            disabled={status === "syncing" || syncRequestPending}
            onClick={() => void forceSync()}
          >
            <span className={`status-dot ${statusClass}`} />
            <span>
              {status === "unconfigured"
                ? l.t("Notion 未配置")
                : status === "syncing"
                  ? l.t("同步中…")
                  : status === "error"
                    ? l.t("同步失败")
                    : l.t("已同步")}
            </span>
          </button>

          <button
            type="button"
            className="workspace-mode-btn"
            disabled={switching}
            title={l.t("切换回桌面便签形态")}
            onClick={() => void setMode("sticky")}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M5 4h14v11l-5 5H5z" />
              <path d="M14 20v-5h5" />
            </svg>
            <span>{l.t("便签模式")}</span>
          </button>

          <button
            type="button"
            className={`icon-btn workspace-pin-btn${alwaysOnTop ? " is-pinned" : ""}`}
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
            aria-label={l.t("设置")}
            onClick={onOpenSettings}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="m9 3-.6 2.2-2 .9-2.1-.6L2 9l1.5 1.6v2.8L2 15l2.3 3.5 2.1-.6 2 .9L9 21h6l.6-2.2 2-.9 2.1.6L22 15l-1.5-1.6v-2.8L22 9l-2.3-3.5-2.1.6-2-.9L15 3Z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          </button>

          <div className="workspace-win-controls">
            <button
              type="button"
              className="win-ctrl-btn"
              title={l.t("最小化")}
              aria-label={l.t("最小化")}
              disabled={!isTauri}
              onClick={() => void minimize()}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14" /></svg>
            </button>
            <button
              type="button"
              className="win-ctrl-btn"
              title={maximized ? l.t("还原窗口") : l.t("最大化")}
              aria-label={maximized ? l.t("还原窗口") : l.t("最大化")}
              disabled={!isTauri}
              onClick={() => void toggleMaximize()}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                {maximized ? (
                  <>
                    <rect x="7" y="4" width="13" height="13" rx="1.5" />
                    <path d="M4 8v11a1.5 1.5 0 0 0 1.5 1.5H17" />
                  </>
                ) : (
                  <rect x="5" y="5" width="14" height="14" rx="1.5" />
                )}
              </svg>
            </button>
            <button
              type="button"
              className="win-ctrl-btn win-ctrl-close"
              title={l.t("关闭窗口，保留在托盘")}
              aria-label={l.t("关闭到托盘")}
              disabled={!isTauri}
              onClick={() => void handleHide()}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
            </button>
          </div>
        </div>
      </header>

      <div className="workspace-body" inert={actions.modalOpen}>
        {sidebarOpen && (
          <aside className="workspace-sidebar" aria-label={l.t("分组导航")}>
            <div className="workspace-sidebar-actions">
              <button
                ref={fallbackFocus}
                type="button"
                className="btn-primary workspace-create-btn"
                onClick={() =>
                  actions.openComposer(
                    selectedGroup && selectedGroup.kind === "local" ? selectedGroup.id : null,
                  )
                }
              >
                {l.t("＋ 新建任务")}
              </button>
              <button
                type="button"
                className="btn-ghost workspace-batch-btn"
                onClick={() => actions.openComposer(null, "batch")}
              >
                {l.t("批量导入")}
              </button>
            </div>

            <div className="workspace-nav-section">
              <button
                type="button"
                className={`workspace-nav-item workspace-nav-home${isHomePage ? " active" : ""}`}
                onClick={() => {
                  setIsHomePage(true);
                  setSelectedGroupId(null);
                }}
              >
                <span className="workspace-nav-home-dot" aria-hidden="true">⌂</span>
                <span className="workspace-nav-label">{l.t("主页")}</span>
                <span className="workspace-nav-count">{l.number(openCount)}</span>
              </button>

              <button
                type="button"
                className={`workspace-nav-item${!isHomePage && selectedGroupId === null ? " active" : ""}`}
                onClick={() => {
                  setIsHomePage(false);
                  setSelectedGroupId(null);
                }}
              >
                <span className="workspace-nav-label">{l.t("全部任务")}</span>
                <span className="workspace-nav-count">{l.number(tasks.length)}</span>
              </button>

              {orderedGroups.map((group) => {
                const label =
                  group.kind === "notion"
                    ? l.t("来自 Notion")
                    : group.kind === "archive"
                      ? l.t("归档")
                      : group.name;
                return (
                  <button
                    key={group.id}
                    type="button"
                    className={`workspace-nav-item${!isHomePage && selectedGroupId === group.id ? " active" : ""}`}
                    onClick={() => {
                      setIsHomePage(false);
                      setSelectedGroupId(group.id);
                    }}
                  >
                    <span className={`group-badge group-badge-${group.kind}`} aria-hidden>
                      {group.kind === "notion" ? "N" : group.kind === "archive" ? "A" : "L"}
                    </span>
                    <span className="workspace-nav-label">{label}</span>
                    <span className="workspace-nav-count">
                      {l.number(countsByGroup.get(group.id) ?? 0)}
                    </span>
                  </button>
                );
              })}

              <button
                type="button"
                className="workspace-nav-add"
                onClick={() => actions.openComposer("new")}
              >
                {l.t("＋ 新建分组")}
              </button>
            </div>

            <div className="workspace-sidebar-footer">
              <span>{l.t("{count} 待办", { count: openCount })}</span>
              <span>{l.t("{count} 组", { count: groups.length })}</span>
            </div>
          </aside>
        )}

        <main className="workspace-main">
          {modeError && (
            <div className="msg error" role="alert">
              <span>{l.errorText(modeError)}</span>
              <button type="button" onClick={clearModeError}>{l.t("知道了")}</button>
            </div>
          )}
          {windowError && <p className="msg error" role="alert">{l.errorText(windowError)}</p>}
          {operationError && (
            <div className="msg error" role="alert">
              <span>{l.errorText(operationError.message)}</span>
              <button type="button" onClick={() => void operationError.retry().catch(() => {})}>{l.t("重试")}</button>
              <button type="button" onClick={dismissOperationError}>{l.t("关闭")}</button>
            </div>
          )}
          {status === "error" && syncState.error && (
            <p className="msg error" role="alert">{l.errorText(syncState.error.message)}</p>
          )}

          {isHomePage ? (
            <HomeView
              tasks={tasks}
              groups={groups}
              selectedTaskId={inspectedTaskId}
              onSelectTask={(task) => setInspectedTaskId(task.id)}
              onToggleTask={actions.toggleTask}
              onQuickCapture={async (title, dayIso) => {
                const targetGroupId =
                  orderedGroups.find((g) => g.kind === "local")?.id ?? null;
                await useTaskStore.getState().importTasks(
                  [title],
                  targetGroupId,
                  targetGroupId ? null : l.t("今日待办"),
                  {
                    startDate: dayIso,
                    endDate: null,
                    startTime: null,
                    endTime: null,
                    reminderAt: null,
                  },
                );
              }}
              onMoveToToday={async (task) => {
                await actions.updateTask(task.id, {
                  updateSchedule: true,
                  startDate: todayIso(),
                  endDate: null,
                  startTime: task.startTime ?? null,
                  endTime: task.endTime ?? null,
                  reminderAt: task.reminderAt ?? null,
                });
              }}
              onOpenScheduleModal={(dayIso) =>
                actions.openComposer(
                  orderedGroups.find((g) => g.kind === "local")?.id ?? null,
                  "single",
                  {
                    startDate: dayIso,
                    endDate: null,
                    startTime: null,
                    endTime: null,
                    reminderAt: null,
                  },
                )
              }
              onJumpToCalendar={(dayIso) => {
                setCalendarFocusDayIso(dayIso);
                setIsHomePage(false);
                setSelectedGroupId(null);
                setActiveView("calendar");
              }}
              onSwitchToSticky={() => void setMode("sticky")}
              onOpenBatchImport={() => actions.openComposer(null, "batch")}
            />
          ) : activeView === "calendar" ? (
            <CalendarView
              tasks={filteredTasks}
              selectedTaskId={inspectedTaskId}
              externalFocusDayIso={calendarFocusDayIso}
              onSelectTask={(task) => setInspectedTaskId(task.id)}
              onToggleTask={actions.toggleTask}
              onRescheduleTask={actions.updateTask}
              onCreateAtSchedule={(schedule) =>
                actions.openComposer(
                  selectedGroup && selectedGroup.kind === "local" ? selectedGroup.id : null,
                  "single",
                  schedule,
                )
              }
            />
          ) : activeView === "board" ? (
            <BoardView
              groups={filteredGroups}
              tasks={filteredTasks}
              selectedTaskId={inspectedTaskId}
              onSelectTask={(task) => setInspectedTaskId(task.id)}
              onToggleTask={actions.toggleTask}
              onMoveTask={(taskId, groupId) => actions.updateTask(taskId, { groupId })}
              onAddTasks={actions.addGroupTasks}
              onCreateGroup={() => actions.openComposer("new")}
              onDeleteGroup={actions.confirmGroup}
            />
          ) : (
            <div className="workspace-list-pane">
              <div className="workspace-pane-head">
                <div>
                  <h2 className="workspace-pane-title">{activeHeading}</h2>
                  <p className="workspace-pane-sub">
                    {l.t("{count} 待办", { count: openCount })} · {l.t("{count} 任务", { count: tasks.length })}
                  </p>
                </div>
                {selectedGroup?.kind === "local" && (
                  <button
                    type="button"
                    className="btn-ghost"
                    onClick={() => actions.openComposer(selectedGroup.id)}
                  >
                    {l.t("＋ 新建任务")}
                  </button>
                )}
                {selectedGroupId !== null && (
                  <button
                    type="button"
                    className="btn-ghost"
                    onClick={() => setSelectedGroupId(null)}
                  >
                    {l.t("查看全部")}
                  </button>
                )}
              </div>
              <div className="task-list workspace-task-scroll">
                <TaskGroups
                  filterGroupId={selectedGroupId}
                  onAddTasks={actions.addGroupTasks}
                  onConfirmGroup={actions.confirmGroup}
                  onConfirmTask={actions.confirmTask}
                  onEditTask={(task) => setInspectedTaskId(task.id)}
                />
                {selectedGroupId === null && (
                  <button
                    type="button"
                    className="add-group"
                    onClick={() => actions.openComposer("new")}
                  >
                    {l.t("＋ 新建分组")}
                  </button>
                )}
              </div>
            </div>
          )}
        </main>

        {inspectedTask && (
          <TaskInspector
            task={inspectedTask}
            groups={groups}
            onSave={actions.updateTask}
            onToggle={actions.toggleTask}
            onDelete={actions.confirmTask}
            onClose={() => setInspectedTaskId(null)}
          />
        )}
      </div>

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
      {!actions.modalOpen && (
        <ReminderAlert
          reminders={actions.activeReminders}
          onComplete={actions.toggleTask}
          onInspect={(task) => setInspectedTaskId(task.id)}
        />
      )}
    </div>
  );
}
