import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type PointerEvent } from "react";
import { useLocale } from "../stores/languageStore";
import { useModeStore } from "../stores/modeStore";
import { useToastStore } from "../stores/toastStore";
import { apiFetchGalleryFeed, apiOpenExternalUrl } from "../services/tauriApi";
import { ARCHIVE_GROUP_ID, NOTION_GROUP_ID, type Group, type RemoteGalleryItem, type Task } from "../types";
import { addDays, parseIsoDate } from "../services/calendarLayout";
import { todayIso } from "../services/taskDate";
import { computeHomeSnapshot, getGreetingKey } from "../services/homeMetrics";
import { buildUnscheduledGraph, sampleAnimatedNodePos } from "../services/taskGraph";
import { UnscheduledGraphModal } from "./UnscheduledGraphModal";
import {
  addGalleryFiles,
  deleteGallerySlide,
  isAnimatedImageMime,
  listGallerySlides,
  type GallerySlideRecord,
} from "../services/galleryDb";

interface Props {
  tasks: Task[];
  groups: Group[];
  selectedTaskId: string | null;
  onSelectTask: (task: Task) => void;
  onToggleTask: (id: string) => Promise<void>;
  onQuickCapture: (title: string, dayIso: string) => Promise<void>;
  onMoveToToday: (task: Task) => Promise<void>;
  onOpenScheduleModal: (dayIso: string) => void;
  onJumpToCalendar: (dayIso: string) => void;
  onSwitchToSticky: () => void;
  onOpenBatchImport: () => void;
}

interface ResolvedSlide extends GallerySlideRecord {
  url: string;
}

const AMBIENT_COVERS = [
  { id: "dawn", titleKey: "晨光暖雾", subtitleKey: "平静开启今天" },
  { id: "aurora", titleKey: "午夜极光", subtitleKey: "保持专注节奏" },
  { id: "zen", titleKey: "静谧墨韵", subtitleKey: "留白亦是效率" },
] as const;

const RING_RADIUS = 17;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

function isEditableLocalTask(task: Task): boolean {
  return !task.notionId && task.groupId !== NOTION_GROUP_ID && task.groupId !== ARCHIVE_GROUP_ID;
}

function handleSpotlightMove(e: PointerEvent<HTMLElement>) {
  const rect = e.currentTarget.getBoundingClientRect();
  e.currentTarget.style.setProperty("--mx", `${e.clientX - rect.left}px`);
  e.currentTarget.style.setProperty("--my", `${e.clientY - rect.top}px`);
}

export function HomeView({
  tasks,
  groups,
  selectedTaskId,
  onSelectTask,
  onToggleTask,
  onQuickCapture,
  onMoveToToday,
  onOpenScheduleModal,
  onJumpToCalendar,
  onSwitchToSticky,
  onOpenBatchImport,
}: Props) {
  const l = useLocale();
  const pushToast = useToastStore((s) => s.pushToast);
  const galleryConfig = useModeStore((s) => s.galleryConfig);
  const isRemoteSource = galleryConfig.source !== "local";
  const [now, setNow] = useState(() => new Date());
  const [captureTitle, setCaptureTitle] = useState("");
  const [capturing, setCapturing] = useState(false);

  const [graphModalOpen, setGraphModalOpen] = useState(false);
  const [hoveredGraphTask, setHoveredGraphTask] = useState<Task | null>(null);
  const miniGraphSvgRef = useRef<SVGSVGElement>(null);

  const [slides, setSlides] = useState<ResolvedSlide[]>([]);
  const [remoteSlides, setRemoteSlides] = useState<RemoteGalleryItem[]>([]);
  const [remoteLoading, setRemoteLoading] = useState(false);
  const [remoteError, setRemoteError] = useState<string | null>(null);
  const [activeSlideIndex, setActiveSlideIndex] = useState(0);
  const [autoPlay, setAutoPlay] = useState(true);
  const [galleryHovered, setGalleryHovered] = useState(false);
  const [ambientIndex, setAmbientIndex] = useState(0);
  const [galleryError, setGalleryError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const slidesUrlRef = useRef<ResolvedSlide[]>([]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 15_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let alive = true;
    void listGallerySlides()
      .then((records) => {
        if (!alive) return;
        const resolved = records.map((r) => ({ ...r, url: URL.createObjectURL(r.blob) }));
        slidesUrlRef.current = resolved;
        setSlides(resolved);
      })
      .catch((error) => {
        if (alive) setGalleryError(error instanceof Error ? error.message : String(error));
      });
    return () => {
      alive = false;
      for (const s of slidesUrlRef.current) {
        URL.revokeObjectURL(s.url);
      }
      slidesUrlRef.current = [];
    };
  }, []);

  const refreshRemoteFeed = useCallback(
    async (notify = false) => {
      if (galleryConfig.source === "local") return;
      setRemoteLoading(true);
      setRemoteError(null);
      try {
        const items = await apiFetchGalleryFeed(galleryConfig);
        setRemoteSlides(items);
        setActiveSlideIndex(0);
        if (notify) {
          pushToast(l.t("已拉取 {count} 张画廊图片", { count: items.length }));
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setRemoteSlides([]);
        setRemoteError(msg);
        if (notify) pushToast(msg, "error");
      } finally {
        setRemoteLoading(false);
      }
    },
    [
      galleryConfig.source,
      galleryConfig.wallhavenQuery,
      galleryConfig.pinterestBoardUrl,
      galleryConfig.unsplashQuery,
      galleryConfig.unsplashAccessKey,
      galleryConfig.proxyUrl,
      l,
      pushToast,
    ],
  );

  useEffect(() => {
    if (galleryConfig.source === "local") {
      setRemoteSlides([]);
      setRemoteError(null);
      setRemoteLoading(false);
      return;
    }
    const timer = window.setTimeout(() => {
      void refreshRemoteFeed(false);
    }, 180);
    return () => window.clearTimeout(timer);
  }, [refreshRemoteFeed, galleryConfig.source]);

  const displaySlides = useMemo(() => {
    if (isRemoteSource) {
      return remoteSlides.map((r) => ({
        id: r.id,
        name: r.title,
        url: r.imageUrl,
        sourceUrl: r.sourceUrl,
        animated: false,
        author: r.author,
        provider: r.provider,
      }));
    }
    return slides.map((s) => ({
      id: s.id,
      name: s.name,
      url: s.url,
      sourceUrl: null as string | null,
      animated: isAnimatedImageMime(s.mimeType),
      author: null as string | null,
      provider: "local",
    }));
  }, [isRemoteSource, remoteSlides, slides]);

  useEffect(() => {
    if (displaySlides.length <= 1 || !autoPlay || galleryHovered) return;
    const timer = window.setInterval(() => {
      setActiveSlideIndex((idx) => (idx + 1) % displaySlides.length);
    }, 8_000);
    return () => window.clearInterval(timer);
  }, [displaySlides.length, autoPlay, galleryHovered]);

  useEffect(() => {
    if (isRemoteSource || slides.length > 0) return;
    const timer = window.setInterval(() => {
      setAmbientIndex((idx) => (idx + 1) % AMBIENT_COVERS.length);
    }, 9_000);
    return () => window.clearInterval(timer);
  }, [isRemoteSource, slides.length]);

  const today = todayIso();
  const tomorrow = addDays(today, 1);
  const snap = useMemo(() => computeHomeSnapshot(tasks, today, now.getTime()), [tasks, today, now]);
  const unscheduledGraph = useMemo(
    () => buildUnscheduledGraph(tasks, groups, l.t("未分类")),
    [tasks, groups, l],
  );
  const graphNodeById = useMemo(
    () => new Map(unscheduledGraph.nodes.map((n) => [n.task.id, n])),
    [unscheduledGraph.nodes],
  );

  useEffect(() => {
    const svg = miniGraphSvgRef.current;
    if (!svg || unscheduledGraph.nodes.length === 0 || graphModalOpen) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

    const nodeEls = Array.from(svg.querySelectorAll<SVGGElement>("[data-node-id]")).map((g) => ({
      id: g.dataset.nodeId!,
      halo: g.querySelector<SVGCircleElement>(".home-graph-halo"),
      dot: g.querySelector<SVGCircleElement>(".home-graph-dot"),
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
      const tSec = (nowMs - t0) * 0.001;
      for (const item of nodeEls) {
        const node = graphNodeById.get(item.id);
        if (!node) continue;
        const pos = sampleAnimatedNodePos(node, tSec, 1);
        const cx = (pos.x / 100) * 320;
        const cy = (pos.y / 100) * 120;
        livePos.set(item.id, { cx, cy });
        const cxStr = cx.toFixed(2);
        const cyStr = cy.toFixed(2);
        item.halo?.setAttribute("cx", cxStr);
        item.halo?.setAttribute("cy", cyStr);
        item.dot?.setAttribute("cx", cxStr);
        item.dot?.setAttribute("cy", cyStr);
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
  }, [unscheduledGraph, graphNodeById, graphModalOpen]);

  const greetingText = l.t(getGreetingKey(now.getHours()));
  const dateHeader = useMemo(
    () =>
      new Intl.DateTimeFormat(l.locale, {
        weekday: "long",
        month: "long",
        day: "numeric",
      }).format(now),
    [l.locale, now],
  );
  const hourStr = String(now.getHours()).padStart(2, "0");
  const minStr = String(now.getMinutes()).padStart(2, "0");

  const todayOpenCount = snap.todayTotalCount - snap.todayDoneCount;
  const ringOffset = RING_CIRCUMFERENCE * (1 - snap.todayProgress);
  const maxPulseTotal = Math.max(1, ...snap.weeklyPulse.map((d) => d.totalCount));

  const safeSlideIndex = displaySlides.length > 0 ? Math.min(activeSlideIndex, displaySlides.length - 1) : 0;
  const activeSlide = displaySlides[safeSlideIndex] ?? null;
  const activeAmbient = AMBIENT_COVERS[ambientIndex % AMBIENT_COVERS.length];
  const providerBadge =
    galleryConfig.source === "wallhaven"
      ? "Wallhaven"
      : galleryConfig.source === "pinterest"
        ? "Pinterest"
        : galleryConfig.source === "unsplash"
          ? "Unsplash"
          : l.t("灵感画廊");

  const submitQuickCapture = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = captureTitle.trim();
    if (!trimmed || capturing) return;
    setCapturing(true);
    try {
      await onQuickCapture(trimmed, today);
      setCaptureTitle("");
      pushToast(l.t("已添加到今日待办"));
    } finally {
      setCapturing(false);
    }
  };

  const handleImportFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setGalleryError(null);
    try {
      const added = await addGalleryFiles(Array.from(files));
      if (added.length > 0) {
        const resolved = added.map((r) => ({ ...r, url: URL.createObjectURL(r.blob) }));
        setSlides((prev) => {
          const next = [...prev, ...resolved];
          slidesUrlRef.current = next;
          setActiveSlideIndex(prev.length);
          return next;
        });
        pushToast(l.t("已导入 {count} 张素材", { count: added.length }));
      }
    } catch (error) {
      setGalleryError(error instanceof Error ? error.message : String(error));
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleDeleteCurrentSlide = async () => {
    if (isRemoteSource || !activeSlide) return;
    const target = slides.find((s) => s.id === activeSlide.id);
    if (!target) return;
    try {
      await deleteGallerySlide(target.id);
      URL.revokeObjectURL(target.url);
      setSlides((prev) => {
        const next = prev.filter((s) => s.id !== target.id);
        slidesUrlRef.current = next;
        setActiveSlideIndex((idx) => (next.length === 0 ? 0 : Math.min(idx, next.length - 1)));
        return next;
      });
      pushToast(l.t("已移除图片"));
    } catch (error) {
      setGalleryError(error instanceof Error ? error.message : String(error));
    }
  };

  const formatReminderTime = (ts: number) =>
    new Intl.DateTimeFormat(l.locale, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(ts));

  const openActiveSource = async () => {
    const targetUrl = activeSlide?.sourceUrl;
    if (!isRemoteSource || !targetUrl) return;
    try {
      await apiOpenExternalUrl(targetUrl);
      pushToast(l.t("已在浏览器中打开来源页面"));
    } catch (error) {
      pushToast(error instanceof Error ? error.message : String(error), "error");
    }
  };

  return (
    <div className="home-root">
      <div className="home-canvas">
        <header className="home-hero">
        <div className="home-hero-copy">
          <div className="home-hero-meta">
            <span className="home-hero-date">{dateHeader}</span>
            <span className="home-hero-clock" aria-label={`${hourStr}:${minStr}`}>
              {hourStr}
              <span className="home-clock-colon">:</span>
              {minStr}
            </span>
          </div>
          <h1 className="home-hero-greeting">{greetingText}</h1>
          <p className="home-hero-summary">
            {snap.todayTotalCount === 0
              ? l.t("今天尚未安排具体日程，可以从右侧快速记下一件事开始。")
              : todayOpenCount === 0
                ? l.t("今日 {total} 项日程已全部完成，节奏很稳。", { total: snap.todayTotalCount })
                : l.t("今日还有 {open} 项待完成（共 {total} 项）。", {
                    open: todayOpenCount,
                    total: snap.todayTotalCount,
                  })}
          </p>
        </div>

        <form className="home-quick-capture" onSubmit={(e) => void submitQuickCapture(e)}>
          <input
            type="text"
            value={captureTitle}
            disabled={capturing}
            placeholder={l.t("记下今天的任务或灵感，按回车加入…")}
            aria-label={l.t("快速记事")}
            onChange={(e) => setCaptureTitle(e.target.value)}
          />
          <button type="submit" disabled={capturing || !captureTitle.trim()} className="home-capture-btn">
            {capturing ? l.t("保存中…") : l.t("加入今天")}
          </button>
        </form>
      </header>

      <div className="home-spread">
        <div className="home-editorial-col">
          <section className="home-surface-card home-today-card" onPointerMove={handleSpotlightMove}>
            <div className="home-card-head">
              <div className="home-today-title-group">
                <div className="home-ring-wrap" aria-hidden="true">
                  <svg viewBox="0 0 42 42" className="home-ring-svg">
                    <circle cx="21" cy="21" r={RING_RADIUS} className="home-ring-track" />
                    <circle
                      cx="21"
                      cy="21"
                      r={RING_RADIUS}
                      className="home-ring-fill"
                      strokeDasharray={RING_CIRCUMFERENCE}
                      strokeDashoffset={ringOffset}
                    />
                  </svg>
                  <span className="home-ring-pct">{Math.round(snap.todayProgress * 100)}%</span>
                </div>
                <div>
                  <span className="home-eyebrow">{l.t("今日聚焦")}</span>
                  <h2 className="home-card-title">
                    {snap.todayTotalCount > 0
                      ? `${l.number(snap.todayDoneCount)} / ${l.number(snap.todayTotalCount)}`
                      : l.t("留白时刻")}
                  </h2>
                </div>
              </div>
              <button
                type="button"
                className="home-icon-pill"
                title={l.t("在此日新建任务")}
                aria-label={`${l.t("在此日新建任务")} ${today}`}
                onClick={() => onOpenScheduleModal(today)}
              >
                +
              </button>
            </div>

            {snap.todayTasks.length === 0 ? (
              <p className="home-empty-hint">{l.t("今天还没有待办，敲上方的快速记事或点右上 ＋ 即可添加。")}</p>
            ) : (
              <ul className="home-task-list">
                {snap.todayTasks.map((task) => (
                  <li
                    key={task.id}
                    className={`home-task-row${task.completed ? " is-done" : ""}${selectedTaskId === task.id ? " is-selected" : ""}`}
                    onClick={() => onSelectTask(task)}
                  >
                    <button
                      type="button"
                      className="cal-mini-check"
                      data-checked={task.completed}
                      aria-checked={task.completed}
                      role="checkbox"
                      onClick={(e) => {
                        e.stopPropagation();
                        void onToggleTask(task.id);
                      }}
                    />
                    <span className="home-task-title">{task.title}</span>
                    {task.startTime && <span className="home-task-time">{task.startTime}</span>}
                    {task.notionId && <span className="home-task-badge">Notion</span>}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="home-surface-card home-tomorrow-card" onPointerMove={handleSpotlightMove}>
            <div className="home-card-head">
              <div>
                <span className="home-eyebrow">{l.t("明日预告")}</span>
                <h2 className="home-card-title">
                  {l.t("{count} 项待安排", { count: snap.tomorrowTasks.length })}
                </h2>
              </div>
              <button
                type="button"
                className="home-icon-pill"
                title={l.t("在此日新建任务")}
                aria-label={`${l.t("在此日新建任务")} ${tomorrow}`}
                onClick={() => onOpenScheduleModal(tomorrow)}
              >
                +
              </button>
            </div>

            {snap.tomorrowTasks.length === 0 ? (
              <p className="home-empty-hint">{l.t("明天暂时清闲，可以提前规划重要事项。")}</p>
            ) : (
              <ul className="home-task-list is-compact">
                {snap.tomorrowTasks.slice(0, 5).map((task) => {
                  const editable = isEditableLocalTask(task);
                  return (
                    <li
                      key={task.id}
                      className={`home-task-row${selectedTaskId === task.id ? " is-selected" : ""}`}
                      onClick={() => onSelectTask(task)}
                    >
                      <span className="home-tomorrow-dot" aria-hidden="true" />
                      <span className="home-task-title">{task.title}</span>
                      {task.startTime && <span className="home-task-time">{task.startTime}</span>}
                      {editable && (
                        <button
                          type="button"
                          className="home-row-action"
                          onClick={(e) => {
                            e.stopPropagation();
                            void onMoveToToday(task);
                          }}
                        >
                          {l.t("移至今天")}
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>

        <section
          className="home-surface-card home-gallery-card"
          aria-label={l.t("视觉画廊")}
          onPointerMove={handleSpotlightMove}
          onMouseEnter={() => setGalleryHovered(true)}
          onMouseLeave={() => setGalleryHovered(false)}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="home-gallery-input"
            aria-label={l.t("导入本地图片或 GIF")}
            onChange={(e) => void handleImportFiles(e.target.files)}
          />

          {displaySlides.length > 0 ? (
            <div className="home-gallery-stage">
              {displaySlides.map((slide, idx) => {
                const isActive = idx === safeSlideIndex;
                const clickable = isActive && isRemoteSource && Boolean(slide.sourceUrl);
                return (
                  <div
                    key={slide.id}
                    className={`home-gallery-frame${isActive ? " is-active" : ""}${clickable ? " is-clickable" : ""}`}
                    aria-hidden={!isActive}
                    title={clickable ? l.t("点击在浏览器中查看原图来源") : undefined}
                    onClick={clickable ? () => void openActiveSource() : undefined}
                  >
                    <img
                      src={slide.url}
                      alt={slide.name}
                      className={`home-gallery-img${!slide.animated ? " is-ken-burns" : ""}`}
                    />
                  </div>
                );
              })}

              <div className="home-gallery-scrim" aria-hidden="true" />

              <div className="home-gallery-top-bar">
                <div className="home-gallery-pill-group">
                  <span className="home-gallery-pill">{providerBadge}</span>
                  {!isRemoteSource && activeSlide?.animated && (
                    <span className="home-gallery-pill is-gif">GIF</span>
                  )}
                </div>
                <div className="home-gallery-controls">
                  {isRemoteSource && activeSlide?.sourceUrl && (
                    <button
                      type="button"
                      className="home-gallery-btn"
                      aria-label={l.t("查看来源")}
                      title={l.t("在浏览器中打开来源页面")}
                      onClick={(e) => {
                        e.stopPropagation();
                        void openActiveSource();
                      }}
                    >
                      ↗
                    </button>
                  )}
                  {isRemoteSource ? (
                    <button
                      type="button"
                      className="home-gallery-btn"
                      disabled={remoteLoading}
                      aria-label={l.t("刷新图库")}
                      title={l.t("刷新图库")}
                      onClick={() => void refreshRemoteFeed(true)}
                    >
                      {remoteLoading ? "…" : "↻"}
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="home-gallery-btn"
                      onClick={() => fileInputRef.current?.click()}
                    >
                      {l.t("＋ 导入")}
                    </button>
                  )}
                  {displaySlides.length > 1 && (
                    <button
                      type="button"
                      className="home-gallery-btn"
                      aria-label={autoPlay ? l.t("暂停轮播") : l.t("自动轮播")}
                      onClick={() => setAutoPlay((v) => !v)}
                    >
                      {autoPlay ? "❚❚" : "▶"}
                    </button>
                  )}
                  {!isRemoteSource && (
                    <button
                      type="button"
                      className="home-gallery-btn"
                      title={l.t("移除当前图片")}
                      aria-label={l.t("移除当前图片")}
                      onClick={() => void handleDeleteCurrentSlide()}
                    >
                      ✕
                    </button>
                  )}
                </div>
              </div>

              <div className="home-gallery-bottom-bar">
                <div className="home-gallery-caption">
                  <span className="home-gallery-name">{activeSlide?.name}</span>
                  {activeSlide?.author && (
                    <span className="home-gallery-author">· {activeSlide.author}</span>
                  )}
                  <span className="home-gallery-index">
                    {safeSlideIndex + 1} / {displaySlides.length}
                  </span>
                </div>
                {displaySlides.length > 1 && (
                  <div className="home-gallery-nav-row">
                    <button
                      type="button"
                      className="home-gallery-arrow"
                      aria-label={l.t("上一张")}
                      onClick={() =>
                        setActiveSlideIndex((idx) => (idx - 1 + displaySlides.length) % displaySlides.length)
                      }
                    >
                      ‹
                    </button>
                    <div className="home-gallery-dots">
                      {displaySlides.map((s, idx) => (
                        <button
                          key={s.id}
                          type="button"
                          aria-label={s.name}
                          className={`home-gallery-dot${idx === safeSlideIndex ? " is-active" : ""}`}
                          onClick={() => setActiveSlideIndex(idx)}
                        />
                      ))}
                    </div>
                    <button
                      type="button"
                      className="home-gallery-arrow"
                      aria-label={l.t("下一张")}
                      onClick={() => setActiveSlideIndex((idx) => (idx + 1) % displaySlides.length)}
                    >
                      ›
                    </button>
                  </div>
                )}
              </div>

              {displaySlides.length > 1 && autoPlay && !galleryHovered && (
                <div key={safeSlideIndex} className="home-gallery-progress" aria-hidden="true" />
              )}
            </div>
          ) : isRemoteSource ? (
            <div className="home-gallery-ambient is-aurora">
              <div className="home-ambient-orb home-ambient-orb-a" aria-hidden="true" />
              <div className="home-ambient-orb home-ambient-orb-b" aria-hidden="true" />
              <div className="home-gallery-top-bar">
                <span className="home-gallery-pill">{providerBadge}</span>
                <button
                  type="button"
                  className="home-gallery-btn"
                  disabled={remoteLoading}
                  onClick={() => void refreshRemoteFeed(true)}
                >
                  {remoteLoading ? l.t("拉取中…") : l.t("刷新图库")}
                </button>
              </div>
              <div className="home-gallery-status">
                {remoteLoading
                  ? l.t("加载图源中…")
                  : remoteError ?? l.t("请先在设置中配置图源参数")}
              </div>
            </div>
          ) : (
            <div className={`home-gallery-ambient is-${activeAmbient.id}`}>
              <div className="home-ambient-orb home-ambient-orb-a" aria-hidden="true" />
              <div className="home-ambient-orb home-ambient-orb-b" aria-hidden="true" />
              <div className="home-gallery-top-bar">
                <span className="home-gallery-pill">{l.t("灵感画廊")}</span>
                <button
                  type="button"
                  className="home-gallery-btn"
                  onClick={() => fileInputRef.current?.click()}
                >
                  {l.t("＋ 导入图片 / GIF")}
                </button>
              </div>
              <div className="home-ambient-footer">
                <div>
                  <div className="home-ambient-title">{l.t(activeAmbient.titleKey)}</div>
                  <div className="home-ambient-sub">{l.t(activeAmbient.subtitleKey)}</div>
                </div>
                <div className="home-gallery-dots">
                  {AMBIENT_COVERS.map((cov, idx) => (
                    <button
                      key={cov.id}
                      type="button"
                      aria-label={l.t(cov.titleKey)}
                      className={`home-gallery-dot${idx === ambientIndex ? " is-active" : ""}`}
                      onClick={() => setAmbientIndex(idx)}
                    />
                  ))}
                </div>
              </div>
            </div>
          )}

          {galleryError && (
            <div className="home-gallery-error" role="alert">
              {galleryError}
            </div>
          )}
        </section>
      </div>

      <div className="home-bottom-strip">
        <section className="home-surface-card home-pulse-card" onPointerMove={handleSpotlightMove}>
          <div className="home-card-head">
            <div>
              <span className="home-eyebrow">{l.t("未来 7 日节奏")}</span>
              <h2 className="home-card-title">{l.t("点击柱条跳转日历")}</h2>
            </div>
            <div className="home-pulse-head-right">
              {snap.nextReminder?.reminderAt && (
                <span className="home-reminder-pill" title={snap.nextReminder.title}>
                  <span className="home-pulse-live-dot" aria-hidden="true" />
                  {formatReminderTime(snap.nextReminder.reminderAt)}
                </span>
              )}
              <button
                type="button"
                className="home-link-btn"
                onClick={() => onJumpToCalendar(today)}
              >
                {l.t("打开日历 →")}
              </button>
            </div>
          </div>

          <div className="home-pulse-bars">
            {snap.weeklyPulse.map((day, idx) => {
              const d = parseIsoDate(day.dayIso);
              const weekdayLabel = d
                ? new Intl.DateTimeFormat(l.locale, { weekday: "short" }).format(d)
                : "";
              const dayNum = d ? d.getDate() : day.dayIso.slice(-2);
              const totalPct = day.totalCount === 0 ? 8 : Math.max(18, (day.totalCount / maxPulseTotal) * 100);
              const donePct = day.totalCount === 0 ? 0 : (day.doneCount / day.totalCount) * 100;

              return (
                <button
                  key={day.dayIso}
                  type="button"
                  className={`home-pulse-col${idx === 0 ? " is-today" : ""}`}
                  title={`${day.dayIso} · ${day.totalCount}`}
                  onClick={() => onJumpToCalendar(day.dayIso)}
                >
                  <span className="home-pulse-count">
                    {day.totalCount > 0 ? l.number(day.totalCount) : ""}
                  </span>
                  <span className="home-pulse-track">
                    <span className="home-pulse-fill" style={{ height: `${totalPct.toFixed(1)}%` }}>
                      {donePct > 0 && (
                        <span className="home-pulse-done" style={{ height: `${donePct.toFixed(1)}%` }} />
                      )}
                    </span>
                  </span>
                  <span className="home-pulse-day">{weekdayLabel}</span>
                  <span className="home-pulse-num">{dayNum}</span>
                </button>
              );
            })}
          </div>
        </section>

        <section
          className="home-surface-card home-graph-card"
          role="button"
          tabIndex={0}
          aria-label={l.t("未排期任务图谱")}
          onPointerMove={handleSpotlightMove}
          onClick={() => setGraphModalOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              setGraphModalOpen(true);
            }
          }}
        >
          <div className="home-card-head">
            <div>
              <span className="home-eyebrow">{l.t("未排期灵感图谱")}</span>
              <h2 className="home-card-title">
                {unscheduledGraph.nodes.length > 0
                  ? `${l.number(unscheduledGraph.nodes.length)} · ${l.t("未排期任务")}`
                  : l.t("全部本地任务均已排期")}
              </h2>
            </div>
            <span className="home-link-btn">{l.t("展开探索 ↗")}</span>
          </div>

          <div className="home-graph-preview">
            {unscheduledGraph.nodes.length === 0 ? (
              <p className="home-empty-hint">{l.t("全部本地任务均已排期")}</p>
            ) : (
              <svg ref={miniGraphSvgRef} viewBox="0 0 320 120" className="home-graph-svg" aria-hidden="true">
                {unscheduledGraph.edges.map((edge) => {
                  const from = graphNodeById.get(edge.fromId);
                  const to = graphNodeById.get(edge.toId);
                  if (!from || !to) return null;
                  return (
                    <line
                      key={edge.id}
                      data-from={edge.fromId}
                      data-to={edge.toId}
                      x1={(from.x / 100) * 320}
                      y1={(from.y / 100) * 120}
                      x2={(to.x / 100) * 320}
                      y2={(to.y / 100) * 120}
                      stroke={edge.color}
                      strokeOpacity={0.28}
                      strokeWidth={1.1}
                    />
                  );
                })}
                {unscheduledGraph.nodes.map((node) => (
                  <g key={node.task.id} data-node-id={node.task.id}>
                    <circle
                      cx={(node.x / 100) * 320}
                      cy={(node.y / 100) * 120}
                      r={node.radius + 3.5}
                      fill={node.color}
                      opacity={0.18}
                      className="home-graph-halo"
                    />
                    <circle
                      cx={(node.x / 100) * 320}
                      cy={(node.y / 100) * 120}
                      r={node.radius}
                      fill={node.color}
                      className="home-graph-dot"
                      onMouseEnter={() => setHoveredGraphTask(node.task)}
                      onMouseLeave={() => setHoveredGraphTask(null)}
                    />
                  </g>
                ))}
              </svg>
            )}
            {hoveredGraphTask && (
              <div className="home-graph-tooltip">{hoveredGraphTask.title}</div>
            )}
          </div>

          <div className="home-graph-card-foot">
            <span>{l.t("点亮未排期灵感节点")}</span>
            <div className="home-inline-links" onClick={(e) => e.stopPropagation()}>
              <button type="button" className="home-link-btn" onClick={onOpenBatchImport}>
                {l.t("批量导入")}
              </button>
              <button type="button" className="home-link-btn" onClick={onSwitchToSticky}>
                {l.t("便签模式")}
              </button>
            </div>
          </div>
        </section>
      </div>
      </div>

      {graphModalOpen && (
        <UnscheduledGraphModal
          tasks={tasks}
          groups={groups}
          selectedTaskId={selectedTaskId}
          onSelectTask={onSelectTask}
          onToggleTask={onToggleTask}
          onScheduleToday={onMoveToToday}
          onClose={() => setGraphModalOpen(false)}
        />
      )}
    </div>
  );
}
