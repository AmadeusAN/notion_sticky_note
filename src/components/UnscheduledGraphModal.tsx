import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useLocale } from "../stores/languageStore";
import { ARCHIVE_GROUP_ID, NOTION_GROUP_ID, type Group, type Task } from "../types";
import { buildUnscheduledGraph, sampleAnimatedNodePos } from "../services/taskGraph";

interface Props {
  tasks: Task[];
  groups: Group[];
  selectedTaskId: string | null;
  onSelectTask: (task: Task) => void;
  onToggleTask: (id: string) => Promise<void>;
  onScheduleToday: (task: Task) => Promise<void>;
  onClose: () => void;
}

type ModalListView = "list" | "board";

function isEditableLocal(task: Task): boolean {
  return !task.notionId && task.groupId !== NOTION_GROUP_ID && task.groupId !== ARCHIVE_GROUP_ID;
}

function truncateLabel(text: string, max = 16): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

export function UnscheduledGraphModal({
  tasks,
  groups,
  selectedTaskId,
  onSelectTask,
  onToggleTask,
  onScheduleToday,
  onClose,
}: Props) {
  const l = useLocale();
  const [rightMode, setRightMode] = useState<ModalListView>("list");
  const [hoveredTaskId, setHoveredTaskId] = useState<string | null>(null);
  const modalSvgRef = useRef<SVGSVGElement>(null);
  const pointerRef = useRef<{ x: number; y: number } | null>(null);
  const offsetsRef = useRef<Map<string, { dx: number; dy: number }>>(new Map());
  const dragRef = useRef<{
    nodeId: string;
    startSvgX: number;
    startSvgY: number;
    originDx: number;
    originDy: number;
    moved: boolean;
  } | null>(null);
  const suppressClickIdRef = useRef<string | null>(null);

  const clientToSvg = (svg: SVGSVGElement, clientX: number, clientY: number) => {
    const rect = svg.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return { x: 320, y: 220 };
    return {
      x: ((clientX - rect.left) / rect.width) * 640,
      y: ((clientY - rect.top) / rect.height) * 440,
    };
  };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const graph = useMemo(
    () =>
      buildUnscheduledGraph(
        tasks,
        groups.map((g) => ({
          ...g,
          name: g.kind === "notion" ? l.t("来自 Notion") : g.kind === "archive" ? l.t("归档") : g.name,
        })),
        l.t("未分类"),
      ),
    [tasks, groups, l],
  );
  const nodeById = useMemo(
    () => new Map(graph.nodes.map((n) => [n.task.id, n])),
    [graph.nodes],
  );
  const activeTaskId = hoveredTaskId ?? selectedTaskId;

  useEffect(() => {
    const svg = modalSvgRef.current;
    if (!svg || graph.nodes.length === 0) return;
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

    const nodeEls = Array.from(svg.querySelectorAll<SVGGElement>("[data-node-id]")).map((g) => ({
      id: g.dataset.nodeId!,
      halo: g.querySelector<SVGCircleElement>(".graph-halo"),
      core: g.querySelector<SVGCircleElement>(".graph-core"),
      label: g.querySelector<SVGTextElement>(".graph-svg-label"),
    }));
    const edgeEls = Array.from(svg.querySelectorAll<SVGLineElement>("[data-from][data-to]")).map((line) => ({
      fromId: line.dataset.from!,
      toId: line.dataset.to!,
      line,
    }));

    const livePos = new Map<string, { cx: number; cy: number }>();
    let rafId = 0;
    const t0 = performance.now();

    const tick = (nowMs: number) => {
      const tSec = reduced ? 0 : (nowMs - t0) * 0.001;
      const pointer = pointerRef.current;
      const drag = dragRef.current;

      for (const item of nodeEls) {
        const node = nodeById.get(item.id);
        if (!node) continue;
        const sampled = reduced
          ? { x: node.x, y: node.y }
          : sampleAnimatedNodePos(node, tSec, 0.85);
        const offset = offsetsRef.current.get(item.id);
        let cx = (sampled.x / 100) * 640 + (offset?.dx ?? 0);
        let cy = (sampled.y / 100) * 440 + (offset?.dy ?? 0);

        if (pointer && drag?.nodeId !== item.id) {
          const dx = cx - pointer.x;
          const dy = cy - pointer.y;
          const dist = Math.hypot(dx, dy);
          if (dist > 0.5 && dist < 92) {
            const push = ((92 - dist) / 92) * 14;
            cx += (dx / dist) * push;
            cy += (dy / dist) * push;
          }
        }

        cx = Math.max(24, Math.min(616, cx));
        cy = Math.max(24, Math.min(416, cy));
        livePos.set(item.id, { cx, cy });

        const cxStr = cx.toFixed(2);
        const cyStr = cy.toFixed(2);
        item.halo?.setAttribute("cx", cxStr);
        item.halo?.setAttribute("cy", cyStr);
        item.core?.setAttribute("cx", cxStr);
        item.core?.setAttribute("cy", cyStr);
        if (item.label) {
          const flip = cx > 460;
          const lx = flip ? cx - node.radius - 8 : cx + node.radius + 8;
          item.label.setAttribute("x", lx.toFixed(2));
          item.label.setAttribute("y", (cy + 4).toFixed(2));
          item.label.setAttribute("text-anchor", flip ? "end" : "start");
        }
      }

      for (const edge of edgeEls) {
        const a = livePos.get(edge.fromId);
        const b = livePos.get(edge.toId);
        if (!a || !b) continue;
        edge.line.setAttribute("x1", a.cx.toFixed(2));
        edge.line.setAttribute("y1", a.cy.toFixed(2));
        edge.line.setAttribute("x2", b.cx.toFixed(2));
        edge.line.setAttribute("y2", b.cy.toFixed(2));
      }

      rafId = window.requestAnimationFrame(tick);
    };

    rafId = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(rafId);
  }, [graph, nodeById]);

  const handleSvgPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const svg = modalSvgRef.current;
    if (!svg) return;
    const pt = clientToSvg(svg, e.clientX, e.clientY);
    pointerRef.current = pt;

    const drag = dragRef.current;
    if (drag) {
      const dx = pt.x - drag.startSvgX;
      const dy = pt.y - drag.startSvgY;
      if (Math.hypot(dx, dy) >= 5) drag.moved = true;
      offsetsRef.current.set(drag.nodeId, {
        dx: drag.originDx + dx,
        dy: drag.originDy + dy,
      });
    }
  };

  const handleSvgPointerUp = () => {
    const drag = dragRef.current;
    if (drag?.moved) {
      suppressClickIdRef.current = drag.nodeId;
    }
    dragRef.current = null;
  };

  const groupedColumns = useMemo(() => {
    const buckets = new Map<string, { name: string; color: string; nodes: typeof graph.nodes }>();
    for (const node of graph.nodes) {
      const existing = buckets.get(node.task.groupId);
      if (existing) existing.nodes.push(node);
      else buckets.set(node.task.groupId, { name: node.groupName, color: node.color, nodes: [node] });
    }
    return [...buckets.entries()];
  }, [graph]);

  return (
    <div
      className="graph-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={l.t("未排期任务图谱")}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="graph-modal">
        <header className="graph-modal-head">
          <div className="graph-modal-title-group">
            <h2>{l.t("未排期任务图谱")}</h2>
            <span className="cal-badge">{l.number(graph.nodes.length)}</span>
          </div>

          <div className="graph-modal-head-actions">
            <div className="cal-segmented" role="group" aria-label={l.t("展示形式")}>
              <button
                type="button"
                className={rightMode === "list" ? "active" : ""}
                aria-pressed={rightMode === "list"}
                onClick={() => setRightMode("list")}
              >
                {l.t("清单视图")}
              </button>
              <button
                type="button"
                className={rightMode === "board" ? "active" : ""}
                aria-pressed={rightMode === "board"}
                onClick={() => setRightMode("board")}
              >
                {l.t("看板视图")}
              </button>
            </div>

            <button
              type="button"
              className="icon-btn"
              aria-label={l.t("关闭")}
              onClick={onClose}
            >
              ×
            </button>
          </div>
        </header>

        <div className="graph-modal-body">
          <div className="graph-modal-canvas">
            {graph.nodes.length === 0 ? (
              <div className="graph-modal-empty">{l.t("全部本地任务均已排期")}</div>
            ) : (
              <svg
                ref={modalSvgRef}
                viewBox="0 0 640 440"
                className="graph-modal-svg"
                role="img"
                aria-label={l.t("未排期任务图谱")}
                onPointerMove={handleSvgPointerMove}
                onPointerUp={handleSvgPointerUp}
                onPointerLeave={() => {
                  pointerRef.current = null;
                  handleSvgPointerUp();
                }}
              >
                {graph.edges.map((edge) => {
                  const from = nodeById.get(edge.fromId);
                  const to = nodeById.get(edge.toId);
                  if (!from || !to) return null;
                  const highlighted = activeTaskId === edge.fromId || activeTaskId === edge.toId;
                  return (
                    <line
                      key={edge.id}
                      data-from={edge.fromId}
                      data-to={edge.toId}
                      x1={(from.x / 100) * 640}
                      y1={(from.y / 100) * 440}
                      x2={(to.x / 100) * 640}
                      y2={(to.y / 100) * 440}
                      stroke={edge.color}
                      strokeOpacity={highlighted ? 0.65 : 0.22}
                      strokeWidth={highlighted ? 2 : 1.2}
                    />
                  );
                })}

                {graph.nodes.map((node) => {
                  const cx = (node.x / 100) * 640;
                  const cy = (node.y / 100) * 440;
                  const isActive = activeTaskId === node.task.id;
                  const textAnchor = node.x > 72 ? "end" : "start";
                  const labelX = node.x > 72 ? cx - node.radius - 8 : cx + node.radius + 8;

                  return (
                    <g
                      key={node.task.id}
                      data-node-id={node.task.id}
                      className={`graph-svg-node${isActive ? " is-active" : ""}`}
                      onMouseEnter={() => setHoveredTaskId(node.task.id)}
                      onMouseLeave={() => setHoveredTaskId(null)}
                      onPointerDown={(e) => {
                        const svg = modalSvgRef.current;
                        if (!svg) return;
                        e.stopPropagation();
                        const pt = clientToSvg(svg, e.clientX, e.clientY);
                        const existing = offsetsRef.current.get(node.task.id);
                        dragRef.current = {
                          nodeId: node.task.id,
                          startSvgX: pt.x,
                          startSvgY: pt.y,
                          originDx: existing?.dx ?? 0,
                          originDy: existing?.dy ?? 0,
                          moved: false,
                        };
                      }}
                      onClick={() => {
                        if (suppressClickIdRef.current === node.task.id) {
                          suppressClickIdRef.current = null;
                          return;
                        }
                        onSelectTask(node.task);
                      }}
                    >
                      <circle
                        cx={cx}
                        cy={cy}
                        r={node.radius + (isActive ? 8 : 4)}
                        fill={node.color}
                        opacity={isActive ? 0.28 : 0.12}
                        className="graph-halo"
                      />
                      <circle
                        cx={cx}
                        cy={cy}
                        r={node.radius + (isActive ? 2.5 : 0)}
                        fill={node.color}
                        stroke="rgba(255,255,255,0.65)"
                        strokeWidth={isActive ? 2 : 1}
                        className="graph-core"
                      />
                      <text
                        x={labelX}
                        y={cy + 4}
                        textAnchor={textAnchor}
                        className="graph-svg-label"
                      >
                        {truncateLabel(node.task.title, 18)}
                      </text>
                    </g>
                  );
                })}
              </svg>
            )}
          </div>

          <div className="graph-modal-panel">
            {graph.nodes.length === 0 ? (
              <p className="home-empty-hint">{l.t("全部本地任务均已排期")}</p>
            ) : rightMode === "list" ? (
              <ul className="graph-panel-list">
                {graph.nodes.map((node) => {
                  const editable = isEditableLocal(node.task);
                  const isActive = activeTaskId === node.task.id;
                  return (
                    <li
                      key={node.task.id}
                      className={`graph-panel-item${isActive ? " is-active" : ""}`}
                      onMouseEnter={() => setHoveredTaskId(node.task.id)}
                      onMouseLeave={() => setHoveredTaskId(null)}
                      onClick={() => onSelectTask(node.task)}
                    >
                      <span className="graph-node-dot" style={{ background: node.color }} aria-hidden="true" />
                      <button
                        type="button"
                        className="cal-mini-check"
                        data-checked={node.task.completed}
                        aria-checked={node.task.completed}
                        role="checkbox"
                        onClick={(e) => {
                          e.stopPropagation();
                          void onToggleTask(node.task.id);
                        }}
                      />
                      <span className="graph-panel-title">{node.task.title}</span>
                      <span className="graph-group-pill">{node.groupName}</span>
                      {editable && (
                        <button
                          type="button"
                          className="home-row-action is-visible"
                          onClick={(e) => {
                            e.stopPropagation();
                            void onScheduleToday(node.task);
                          }}
                        >
                          {l.t("排到今天")}
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <div className="graph-panel-board">
                {groupedColumns.map(([groupId, bucket]) => (
                  <div key={groupId} className="graph-board-col">
                    <div className="graph-board-head">
                      <span className="graph-node-dot" style={{ background: bucket.color }} aria-hidden="true" />
                      <span>{bucket.name}</span>
                      <span className="cal-badge">{l.number(bucket.nodes.length)}</span>
                    </div>
                    <div className="graph-board-cards">
                      {bucket.nodes.map((node) => {
                        const editable = isEditableLocal(node.task);
                        const isActive = activeTaskId === node.task.id;
                        return (
                          <div
                            key={node.task.id}
                            className={`graph-board-card${isActive ? " is-active" : ""}`}
                            onMouseEnter={() => setHoveredTaskId(node.task.id)}
                            onMouseLeave={() => setHoveredTaskId(null)}
                            onClick={() => onSelectTask(node.task)}
                          >
                            <div className="graph-board-card-top">
                              <button
                                type="button"
                                className="cal-mini-check"
                                data-checked={node.task.completed}
                                aria-checked={node.task.completed}
                                role="checkbox"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void onToggleTask(node.task.id);
                                }}
                              />
                              <span className="graph-panel-title">{node.task.title}</span>
                            </div>
                            {editable && (
                              <button
                                type="button"
                                className="home-row-action is-visible"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void onScheduleToday(node.task);
                                }}
                              >
                                {l.t("排到今天")}
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
