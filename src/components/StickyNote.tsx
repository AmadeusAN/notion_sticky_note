import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { TaskItem } from "./TaskItem";
import { useFxAmbientPulse, type DockEdge, type DockPhase } from "../fx";
import { useTaskStore } from "../stores/taskStore";
import { useSettingsStore } from "../stores/settingsStore";
import { useNotePhysics } from "../hooks/useNotePhysics";

interface Props {
  onOpenSettings: () => void;
}

interface DockSnapshot {
  phase: DockPhase;
  edge: DockEdge | null;
}

function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export function StickyNote({ onOpenSettings }: Props) {
  const tasks = useTaskStore((s) => s.tasks);
  const status = useTaskStore((s) => s.status);
  const lastError = useTaskStore((s) => s.lastError);
  const forceSync = useTaskStore((s) => s.forceSync);
  const dockHandle = useSettingsStore((s) => s.dockHandle);
  const [dock, setDock] = useState<DockSnapshot>({ phase: "free", edge: null });
  const { ref } = useNotePhysics(dock.phase === "free");

  useFxAmbientPulse(dock.phase, dock.edge);

  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    void (async () => {
      try {
        const snap = await invoke<DockSnapshot>("get_edge_dock");
        setDock(snap);
      } catch {
        /* ignore */
      }
      unlisten = await listen<DockSnapshot>("edge-dock-changed", (e) => {
        setDock(e.payload);
      });
    })();
    return () => {
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    document.documentElement.dataset.dockPhase = dock.phase;
    document.documentElement.dataset.dockEdge = dock.edge ?? "";
    return () => {
      delete document.documentElement.dataset.dockPhase;
      delete document.documentElement.dataset.dockEdge;
    };
  }, [dock.phase, dock.edge]);

  const openCount = tasks.filter((t) => !t.completed).length;
  const title =
    tasks.find((t) => !t.completed)?.title ??
    tasks[0]?.title ??
    "Sticky Note";

  const statusClass =
    status === "syncing"
      ? "syncing"
      : status === "error"
        ? "error"
        : "";

  const dockClass =
    dock.phase !== "free" && dock.edge
      ? `dock-${dock.phase} dock-edge-${dock.edge} dock-handle-${dockHandle}`
      : `dock-handle-${dockHandle}`;

  return (
    <div
      className={`sticky-note ${dockClass}`.trim()}
      ref={ref}
      data-dock-phase={dock.phase}
      data-dock-edge={dock.edge ?? ""}
    >
      <header className="note-header" data-tauri-drag-region>
        <h1 className="note-title" data-tauri-drag-region title={title}>
          {title.length > 28 ? `${title.slice(0, 28)}…` : title}
        </h1>
        <button
          type="button"
          className="icon-btn"
          title="同步"
          onClick={() => void forceSync()}
          aria-label="同步"
        >
          ↻
        </button>
        <button
          type="button"
          className="icon-btn"
          title="设置"
          onClick={onOpenSettings}
          aria-label="设置"
        >
          ⚙
        </button>
      </header>

      <div className="task-list">
        {tasks.length === 0 ? (
          <div className="empty-state">
            还没有任务。
            <br />
            打开设置连接 Notion Database，或等待同步。
          </div>
        ) : (
          tasks.map((task) => <TaskItem key={task.id} task={task} />)
        )}
      </div>

      <footer className="note-footer">
        <span>
          <span className={`status-dot ${statusClass}`} />
          {status === "syncing"
            ? "同步中…"
            : status === "error"
              ? lastError ?? "同步失败"
              : `${openCount} 项待办`}
        </span>
        <span>{tasks.length} tasks</span>
      </footer>
      <div className="dock-tab" aria-hidden data-tauri-drag-region />
      <div className="resize-handle" aria-hidden />
    </div>
  );
}
