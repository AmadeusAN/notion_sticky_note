import { useLocale } from "../stores/languageStore";
import { useEffect, useRef, useState } from "react";
import {
  themes,
  themesInMode,
  type ThemeId,
  type ThemeMode,
} from "../themes";
import { fonts, fontIds, type FontId } from "../fonts";
import { fxThemes, fxThemeIds, type FxThemeId } from "../fx/themes";
import {
  dockHandles,
  dockHandleIds,
  type DockHandleId,
} from "../dockHandles";
import { useSettingsStore } from "../stores/settingsStore";
import { useModeStore } from "../stores/modeStore";
import { useToastStore } from "../stores/toastStore";
import { apiFetchGalleryFeed } from "../services/tauriApi";
import type { CalendarFocusStyle, GallerySource } from "../types";
import { LanguageSettings } from "./LanguageSettings";
import { AutostartSettings } from "./AutostartSettings";

interface Props {
  onClose: () => void;
}

function ThemePicker({
  ids,
  active,
  onPick,
}: {
  ids: ThemeId[];
  active: ThemeId;
  onPick: (id: ThemeId) => void;
}) {
  const l = useLocale();
  if (ids.length === 0) return null;
  return (
    <div className="theme-grid theme-grid-wide">
      {ids.map((id) => (
        <button
          key={id}
          type="button"
          className={`theme-card${active === id ? " active" : ""}`}
          aria-pressed={active === id}
          onClick={() => onPick(id)}
        >
          <div
            className="theme-swatch"
            style={{
              background: themes[id].tray
                ? `linear-gradient(135deg, ${themes[id].tray} 40%, ${themes[id].card ?? themes[id].background} 40%)`
                : themes[id].background,
              boxShadow:
                themes[id].group !== "flat"
                  ? "inset 0 0 0 1px rgba(0,0,0,0.06)"
                  : undefined,
            }}
          >
            {themes[id].group !== "flat" ? (
              <span
                className="theme-swatch-dot"
                style={{ background: themes[id].pop }}
              />
            ) : null}
          </div>
          {l.label(themes[id].label)}
        </button>
      ))}
    </div>
  );
}

function ModeThemeSection({
  mode,
  selected,
  systemMode,
  onPick,
}: {
  mode: ThemeMode;
  selected: ThemeId;
  systemMode: ThemeMode;
  onPick: (id: ThemeId) => void;
}) {
  const l = useLocale();
  const isActive = systemMode === mode;
  const title = mode === "light" ? l.t("浅色主题") : l.t("深色主题");
  const groups = [
    { key: "flat" as const, label: l.t("扁平") },
    { key: "layered" as const, label: l.t("层级卡片") },
    { key: "motion" as const, label: l.t("动效") },
  ];

  return (
    <div className={`theme-mode-section${isActive ? " is-system-active" : ""}`}>
      <div className="theme-mode-header">
        <label>{title}</label>
        {isActive ? <span className="theme-mode-badge">{l.t("当前系统")}</span> : null}
      </div>
      {groups.map(({ key, label }) => {
        const ids = themesInMode(mode, key);
        if (ids.length === 0) return null;
        return (
          <div key={key} className="field" style={{ marginTop: key === "flat" ? 8 : 12 }}>
            <p className="hint" style={{ marginBottom: 8 }}>
              {label}
            </p>
            <ThemePicker ids={ids} active={selected} onPick={onPick} />
          </div>
        );
      })}
    </div>
  );
}

export function SettingsPanel({ onClose }: Props) {
  const l = useLocale();
  const theme = useSettingsStore((s) => s.theme);
  const hydrated = useSettingsStore((s) => s.hydrated);
  const flushAppearance = useSettingsStore((s) => s.flushAppearance);
  useEffect(() => () => { void flushAppearance(); }, [flushAppearance]);
  const commitAppearance = (change: () => Promise<void>) => {
    void change();
    void flushAppearance();
  };
  const lightTheme = useSettingsStore((s) => s.lightTheme);
  const darkTheme = useSettingsStore((s) => s.darkTheme);
  const systemMode = useSettingsStore((s) => s.systemMode);
  const font = useSettingsStore((s) => s.font);
  const fxTheme = useSettingsStore((s) => s.fxTheme);
  const fxIntensity = useSettingsStore((s) => s.fxIntensity);
  const fxEdgeBoost = useSettingsStore((s) => s.fxEdgeBoost);
  const dockHandle = useSettingsStore((s) => s.dockHandle);
  const notion = useSettingsStore((s) => s.notion);
  const message = useSettingsStore((s) => s.message);
  const error = useSettingsStore((s) => s.error);
  const notionOperation = useSettingsStore((s) => s.notionOperation);
  const notionConfirmation = useSettingsStore((s) => s.notionConfirmation);
  const notionBusy = notionOperation !== null;
  const setLightThemeLocal = useSettingsStore((s) => s.setLightThemeLocal);
  const setDarkThemeLocal = useSettingsStore((s) => s.setDarkThemeLocal);
  const setFontLocal = useSettingsStore((s) => s.setFontLocal);
  const setFxThemeLocal = useSettingsStore((s) => s.setFxThemeLocal);
  const setFxIntensityLocal = useSettingsStore((s) => s.setFxIntensityLocal);
  const setFxEdgeBoostLocal = useSettingsStore((s) => s.setFxEdgeBoostLocal);
  const setDockHandleLocal = useSettingsStore((s) => s.setDockHandleLocal);
  const calendarFocusStyle = useModeStore((s) => s.calendarFocusStyle);
  const setCalendarFocusStyle = useModeStore((s) => s.setCalendarFocusStyle);
  const calendarFocusSize = useModeStore((s) => s.calendarFocusSize);
  const setCalendarFocusSize = useModeStore((s) => s.setCalendarFocusSize);
  const galleryConfig = useModeStore((s) => s.galleryConfig);
  const updateGalleryConfig = useModeStore((s) => s.updateGalleryConfig);
  const pushToast = useToastStore((s) => s.pushToast);
  const [testingGallery, setTestingGallery] = useState(false);
  const [galleryTestMsg, setGalleryTestMsg] = useState<string | null>(null);
  const [addingTag, setAddingTag] = useState(false);
  const [newTagDraft, setNewTagDraft] = useState("");
  const updateNotionDraft = useSettingsStore((s) => s.updateNotionDraft);
  const saveNotion = useSettingsStore((s) => s.saveNotion);
  const testNotion = useSettingsStore((s) => s.testNotion);
  const discardPendingAndSaveNotion = useSettingsStore((s) => s.discardPendingAndSaveNotion);
  const cancelNotionConfirmation = useSettingsStore((s) => s.cancelNotionConfirmation);

  const [activeSection, setActiveSection] = useState<"general" | "appearance" | "calendar" | "notion">("general");
  const bodyRef = useRef<HTMLDivElement>(null);

  const scrollToSection = (id: "general" | "appearance" | "calendar" | "notion") => {
    setActiveSection(id);
    const body = bodyRef.current;
    const target = body?.querySelector<HTMLElement>(`#settings-${id}`);
    if (body && target) {
      body.scrollTo({ top: Math.max(0, target.offsetTop - 16), behavior: "smooth" });
    }
  };

  const handleBodyScroll = () => {
    const body = bodyRef.current;
    if (!body) return;
    const top = body.scrollTop + 48;
    const ids: Array<"general" | "appearance" | "calendar" | "notion"> = ["general", "appearance", "calendar", "notion"];
    let current: "general" | "appearance" | "calendar" | "notion" = "general";
    for (const id of ids) {
      const el = body.querySelector<HTMLElement>(`#settings-${id}`);
      if (el && el.offsetTop <= top) current = id;
    }
    if (current !== activeSection) setActiveSection(current);
  };

  return (
    <div
      className="settings-panel"
      onPointerUpCapture={() => void flushAppearance()}
      onKeyUpCapture={() => void flushAppearance()}
      onBlurCapture={() => void flushAppearance()}
    >
      <header className="settings-header" data-tauri-drag-region>
        <h2 data-tauri-drag-region>{l.t("设置")}</h2>
        <button type="button" className="icon-btn" onClick={() => { void flushAppearance(); onClose(); }} aria-label={l.t("关闭")}>
          ✕
        </button>
      </header>

      <div className="settings-layout">
        <nav className="settings-nav" aria-label={l.t("设置分类")}>
          <button
            type="button"
            className={`settings-nav-btn${activeSection === "general" ? " active" : ""}`}
            onClick={() => scrollToSection("general")}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="12" cy="12" r="3.2" />
              <path d="M19.4 15a1.6 1.6 0 0 0 .33 1.78l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.6 1.6 0 0 0-1.78-.33 1.6 1.6 0 0 0-.98 1.46V21a2 2 0 1 1-4 0v-.09a1.6 1.6 0 0 0-1.04-1.46 1.6 1.6 0 0 0-1.78.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.6 1.6 0 0 0 .33-1.78 1.6 1.6 0 0 0-1.46-.98H3a2 2 0 1 1 0-4h.09a1.6 1.6 0 0 0 1.46-1.04 1.6 1.6 0 0 0-.33-1.78l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.6 1.6 0 0 0 1.78.33h.08a1.6 1.6 0 0 0 .98-1.46V3a2 2 0 1 1 4 0v.09a1.6 1.6 0 0 0 .98 1.46 1.6 1.6 0 0 0 1.78-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.6 1.6 0 0 0-.33 1.78v.08a1.6 1.6 0 0 0 1.46.98H21a2 2 0 1 1 0 4h-.09a1.6 1.6 0 0 0-1.46.98Z" />
            </svg>
            <span>{l.t("通用")}</span>
          </button>
          <button
            type="button"
            className={`settings-nav-btn${activeSection === "appearance" ? " active" : ""}`}
            onClick={() => scrollToSection("appearance")}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="13.5" cy="6.5" r="1" fill="currentColor" stroke="none" />
              <circle cx="17.5" cy="10.5" r="1" fill="currentColor" stroke="none" />
              <circle cx="8.5" cy="7.5" r="1" fill="currentColor" stroke="none" />
              <circle cx="6.5" cy="12.5" r="1" fill="currentColor" stroke="none" />
              <path d="M12 3a9 9 0 0 0 0 18c1.1 0 2-.9 2-2 0-.5-.2-1-.5-1.4-.3-.4-.5-.8-.5-1.3 0-1.1.9-2 2-2h2.4A4.6 4.6 0 0 0 21 9.7C21 5.9 17 3 12 3Z" />
            </svg>
            <span>{l.t("外观主题")}</span>
          </button>
          <button
            type="button"
            className={`settings-nav-btn${activeSection === "calendar" ? " active" : ""}`}
            onClick={() => scrollToSection("calendar")}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
              <path d="M8 3.5V6.5M16 3.5V6.5M3.5 9.5h17" />
              <circle cx="12" cy="14.5" r="2.2" />
            </svg>
            <span>{l.t("日历与画廊")}</span>
          </button>
          <button
            type="button"
            className={`settings-nav-btn${activeSection === "notion" ? " active" : ""}`}
            onClick={() => scrollToSection("notion")}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 12a8 8 0 0 1 13.7-5.6L20 8.5M20 4v4.5h-4.5M20 12a8 8 0 0 1-13.7 5.6L4 15.5M4 20v-4.5h4.5" />
            </svg>
            <span>{l.t("Notion 配置")}</span>
          </button>
        </nav>

        <div ref={bodyRef} className="settings-body" onScroll={handleBodyScroll}>
          <div className="settings-content-inner">
            <section id="settings-general" className="settings-card">
              <h3 className="settings-card-title">{l.t("通用")}</h3>
              <div className="settings-grid-2">
                <LanguageSettings />
                <AutostartSettings />
              </div>
            </section>

            <fieldset
              id="settings-appearance"
              disabled={!hydrated}
              aria-label={l.t("外观")}
              className="settings-card"
              style={{ border: undefined, margin: 0, minWidth: 0 }}
            >
              <h3 className="settings-card-title">{l.t("外观主题")}</h3>
              <p className="hint" style={{ margin: 0 }}>
                {l.t("已按浅色 / 深色分类。默认浅色「Classic Paper」、深色「Dark OLED」； 实际显示会跟随系统外观自动切换。当前生效：")}<strong style={{ marginLeft: 4 }}>{l.label(themes[theme]?.label ?? theme)}</strong>
              </p>

              <div className="settings-themes-split">
                <ModeThemeSection
                  mode="light"
                  selected={lightTheme}
                  systemMode={systemMode}
                  onPick={(id) => commitAppearance(() => setLightThemeLocal(id))}
                />
                <ModeThemeSection
                  mode="dark"
                  selected={darkTheme}
                  systemMode={systemMode}
                  onPick={(id) => commitAppearance(() => setDarkThemeLocal(id))}
                />
              </div>

              <div className="settings-grid-2">
                <div className="field">
                  <label htmlFor="appearance-font">{l.t("字体")}</label>
                  <select
                    id="appearance-font"
                    value={font}
                    onChange={(e) => commitAppearance(() => setFontLocal(e.target.value as FontId))}
                    style={{ fontFamily: fonts[font]?.family }}
                  >
                    {fontIds.map((id) => (
                      <option key={id} value={id} style={{ fontFamily: fonts[id].family }}>
                        {l.label(fonts[id].label)}
                      </option>
                    ))}
                  </select>
                  <p className="hint" style={{ marginTop: 6 }}>
                    {l.t("预览：")}<span style={{ fontFamily: fonts[font]?.family, marginLeft: 6 }}>
                      {l.t("今日待办 · Sticky Note")}</span>
                  </p>
                </div>

                <div className="field">
                  <label htmlFor="appearance-dock-handle">{l.t("贴边扶手")}</label>
                  <select
                    id="appearance-dock-handle"
                    value={dockHandle}
                    onChange={(e) =>
                      commitAppearance(() => setDockHandleLocal(e.target.value as DockHandleId))
                    }
                  >
                    {dockHandleIds.map((id) => (
                      <option key={id} value={id}>
                        {l.label(dockHandles[id].label)}
                      </option>
                    ))}
                  </select>
                  <p className="hint" style={{ marginTop: 6 }}>
                    {l.label(dockHandles[dockHandle]?.hint ?? "")}
                  </p>
                </div>
              </div>

              <div className="settings-subcard settings-grid-2">
                <div className="field">
                  <label htmlFor="appearance-fx-theme">{l.t("贴边特效")}</label>
                  <select
                    id="appearance-fx-theme"
                    value={fxTheme}
                    onChange={(e) =>
                      commitAppearance(() => setFxThemeLocal(e.target.value as FxThemeId))
                    }
                  >
                    {fxThemeIds.map((id) => (
                      <option key={id} value={id}>
                        {id === "none" ? l.t("关闭特效") : l.label(fxThemes[id].label)}
                      </option>
                    ))}
                  </select>
                  <p className="hint" style={{ marginTop: 6 }}>
                    {l.t("生长：叶片 / 樱花 / 藤蔓 / 冰锥 / 墨迹；氛围：雨滴 / 雪花 / 萤火。")}</p>
                </div>

                <div className="field">
                  <label htmlFor="appearance-intensity">
                    {l.t("特效强度")}{" "}
                    <span style={{ opacity: 0.65 }}>
                      {new Intl.NumberFormat(l.locale, { style: "percent" }).format(fxIntensity)}
                    </span>
                  </label>
                  <input
                    id="appearance-intensity"
                    type="range"
                    min={40}
                    max={160}
                    step={5}
                    value={Math.round(fxIntensity * 100)}
                    onChange={(e) =>
                      void setFxIntensityLocal(Number(e.target.value) / 100)
                    }
                  />
                  <p className="hint" style={{ marginTop: 6 }}>
                    {l.t("控制粒子密度与整体可见度；浅色便签会自动略加强对比。")}</p>
                  <label className="check-row" style={{ marginTop: 10 }}>
                    <input
                      type="checkbox"
                      checked={fxEdgeBoost}
                      onChange={(e) => commitAppearance(() => setFxEdgeBoostLocal(e.target.checked))}
                    />
                    {l.t("边缘高对比")}</label>
                  <p className="hint" style={{ marginTop: 4 }}>
                    {l.t("只加强贴边 fringe / 近景粒子，避免整窗糊成雨幕。")}</p>
                </div>
              </div>
            </fieldset>

            <section id="settings-calendar" className="settings-card">
              <h3 className="settings-card-title">{l.t("日历与画廊")}</h3>
              <div className="settings-grid-2">
                <div className="field">
                  <label>{l.t("日历聚焦动效")}</label>
                  <div className="cal-segmented" role="group" aria-label={l.t("日历聚焦动效")} style={{ alignSelf: "flex-start" }}>
                    {(
                      [
                        ["smooth", "丝滑透镜"],
                        ["mosaic", "动态拼花"],
                        ["off", "关闭聚焦"],
                      ] as const satisfies readonly [CalendarFocusStyle, "丝滑透镜" | "动态拼花" | "关闭聚焦"][]
                    ).map(([value, labelKey]) => (
                      <button
                        key={value}
                        type="button"
                        className={calendarFocusStyle === value ? "active" : ""}
                        aria-pressed={calendarFocusStyle === value}
                        onClick={() => setCalendarFocusStyle(value)}
                      >
                        {l.t(labelKey)}
                      </button>
                    ))}
                  </div>
                  <p className="hint" style={{ marginTop: 6 }}>
                    {calendarFocusStyle === "smooth"
                      ? l.t("GPU 平移放大画布 + 周边柔和模糊，零卡顿（推荐）。")
                      : calendarFocusStyle === "mosaic"
                        ? l.t("随鼠标动态重算周边网格大小，产生弹性拼花缩放效果。")
                        : l.t("始终以固定网格显示完整月历，不启用聚焦与模糊。")}
                  </p>
                </div>

                <div className="field">
                  <div className="settings-focus-size-head">
                    <label htmlFor="calendar-focus-size">
                      {l.t("聚焦区域大小")}{" "}
                      <span style={{ opacity: 0.65 }}>
                        {new Intl.NumberFormat(l.locale, { style: "percent" }).format(calendarFocusSize)}
                      </span>
                    </label>
                    <div className="settings-size-presets" role="group" aria-label={l.t("聚焦区域大小")}>
                      {(
                        [
                          [0.75, "小"],
                          [1.0, "中"],
                          [1.3, "大"],
                        ] as const satisfies readonly [number, "小" | "中" | "大"][]
                      ).map(([presetValue, presetKey]) => (
                        <button
                          key={presetKey}
                          type="button"
                          disabled={calendarFocusStyle === "off"}
                          className={`settings-preset-btn${Math.abs(calendarFocusSize - presetValue) < 0.03 ? " active" : ""}`}
                          onClick={() => setCalendarFocusSize(presetValue)}
                        >
                          {l.t(presetKey)}
                        </button>
                      ))}
                    </div>
                  </div>
                  <input
                    id="calendar-focus-size"
                    type="range"
                    min={65}
                    max={145}
                    step={5}
                    disabled={calendarFocusStyle === "off"}
                    value={Math.round(calendarFocusSize * 100)}
                    onChange={(e) => setCalendarFocusSize(Number(e.target.value) / 100)}
                  />
                    <p className="hint" style={{ marginTop: 6 }}>
                      {l.t("调整聚焦高亮窗口与清晰视野范围，在丝滑透镜与动态拼花下均生效。")}
                    </p>
                </div>
              </div>

              <div className="settings-subcard">
                <div className="field">
                  <label>{l.t("灵感画廊图源")}</label>
                  <div className="cal-segmented" role="group" aria-label={l.t("灵感画廊图源")} style={{ alignSelf: "flex-start" }}>
                    {(
                      [
                        ["local", l.t("本地图片/GIF")],
                        ["wallhaven", "Wallhaven"],
                        ["pinterest", "Pinterest"],
                        ["unsplash", "Unsplash"],
                      ] as const satisfies readonly [GallerySource, string][]
                    ).map(([value, label]) => (
                      <button
                        key={value}
                        type="button"
                        className={galleryConfig.source === value ? "active" : ""}
                        aria-pressed={galleryConfig.source === value}
                        onClick={() => {
                          setGalleryTestMsg(null);
                          updateGalleryConfig({ source: value });
                        }}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                {galleryConfig.source === "local" ? (
                  <p className="hint" style={{ marginTop: 8 }}>
                    {l.t("已选择本地画廊：在主页右上点击「＋ 导入」即可选择本地静态图与 GIF 动图进行轮播。")}
                  </p>
                ) : galleryConfig.source === "wallhaven" ? (
                  <div className="field" style={{ marginTop: 10 }}>
                    <label htmlFor="gallery-wallhaven-query">{l.t("壁纸关键词（留空默认热门榜单）")}</label>
                    <input
                      id="gallery-wallhaven-query"
                      type="text"
                      placeholder={l.t("例如：anime, minimalism, landscape")}
                      value={galleryConfig.wallhavenQuery}
                      onChange={(e) => updateGalleryConfig({ wallhavenQuery: e.target.value })}
                    />
                    <div className="settings-tag-chips">
                      {galleryConfig.wallhavenTags.map((tag) => {
                        const isActive =
                          galleryConfig.wallhavenQuery.trim().toLowerCase() === tag.toLowerCase();
                        return (
                          <span
                            key={tag}
                            className={`settings-tag-chip${isActive ? " active" : ""}`}
                          >
                            <button
                              type="button"
                              className="settings-tag-label"
                              onClick={() => updateGalleryConfig({ wallhavenQuery: tag })}
                            >
                              {tag}
                            </button>
                            <button
                              type="button"
                              className="settings-tag-remove"
                              aria-label={`${l.t("删除关键词")} ${tag}`}
                              title={`${l.t("删除关键词")} ${tag}`}
                              onClick={() => {
                                updateGalleryConfig({
                                  wallhavenTags: galleryConfig.wallhavenTags.filter((t) => t !== tag),
                                });
                              }}
                            >
                              ×
                            </button>
                          </span>
                        );
                      })}
                      {addingTag ? (
                        <input
                          id="gallery-new-tag-input"
                          type="text"
                          autoFocus
                          className="settings-tag-inline-input"
                          placeholder={l.t("输入关键词回车添加")}
                          value={newTagDraft}
                          onChange={(e) => setNewTagDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              const next = newTagDraft.trim();
                              if (next) {
                                const exists = galleryConfig.wallhavenTags.some(
                                  (t) => t.toLowerCase() === next.toLowerCase(),
                                );
                                updateGalleryConfig({
                                  wallhavenTags: exists
                                    ? galleryConfig.wallhavenTags
                                    : [...galleryConfig.wallhavenTags, next],
                                  wallhavenQuery: next,
                                });
                              }
                              setNewTagDraft("");
                              setAddingTag(false);
                            } else if (e.key === "Escape") {
                              e.preventDefault();
                              setNewTagDraft("");
                              setAddingTag(false);
                            }
                          }}
                          onBlur={() => {
                            setNewTagDraft("");
                            setAddingTag(false);
                          }}
                        />
                      ) : (
                        <button
                          type="button"
                          className="settings-tag-add-btn"
                          aria-label={l.t("添加关键词")}
                          title={l.t("添加关键词")}
                          onClick={() => setAddingTag(true)}
                        >
                          +
                        </button>
                      )}
                    </div>
                    <p className="hint" style={{ marginTop: 6 }}>
                      {l.t("无需登录和 Token，仅拉取 SFW 公开壁纸。")}
                    </p>
                  </div>
                ) : galleryConfig.source === "pinterest" ? (
                  <div className="field" style={{ marginTop: 10 }}>
                    <label htmlFor="gallery-pinterest-board">{l.t("Pinterest 公开画板链接")}</label>
                    <input
                      id="gallery-pinterest-board"
                      type="text"
                      placeholder={l.t("https://www.pinterest.com/用户名/画板名/")}
                      value={galleryConfig.pinterestBoardUrl}
                      onChange={(e) => updateGalleryConfig({ pinterestBoardUrl: e.target.value })}
                    />
                    <p className="hint" style={{ marginTop: 6 }}>
                      {l.t("通过公开画板 RSS 自动同步你收藏的图片，无需登录或配置 Token（需将画板设为公开）。")}
                    </p>
                  </div>
                ) : (
                  <div className="settings-grid-2" style={{ marginTop: 10 }}>
                    <div className="field">
                      <label htmlFor="gallery-unsplash-query">{l.t("摄影主题关键词")}</label>
                      <input
                        id="gallery-unsplash-query"
                        type="text"
                        placeholder={l.t("例如：minimal workspace, architecture")}
                        value={galleryConfig.unsplashQuery}
                        onChange={(e) => updateGalleryConfig({ unsplashQuery: e.target.value })}
                      />
                    </div>
                    <div className="field">
                      <label htmlFor="gallery-unsplash-key">Unsplash Access Key</label>
                      <input
                        id="gallery-unsplash-key"
                        type="password"
                        autoComplete="off"
                        placeholder="Access Key..."
                        value={galleryConfig.unsplashAccessKey}
                        onChange={(e) => updateGalleryConfig({ unsplashAccessKey: e.target.value })}
                      />
                    </div>
                    <p className="hint" style={{ gridColumn: "1 / -1", marginTop: -4 }}>
                      {l.t("在 unsplash.com/developers 免费创建应用获取 Access Key（一次填写，无需登录账号）。")}
                    </p>
                  </div>
                )}

                {galleryConfig.source !== "local" && (
                  <>
                    <div className="field" style={{ marginTop: 10 }}>
                      <label htmlFor="gallery-proxy-url">{l.t("代理地址（可选，留空自动跟随系统代理）")}</label>
                      <input
                        id="gallery-proxy-url"
                        type="text"
                        placeholder="http://127.0.0.1:7897"
                        value={galleryConfig.proxyUrl}
                        onChange={(e) => updateGalleryConfig({ proxyUrl: e.target.value })}
                      />
                      <p className="hint" style={{ marginTop: 6 }}>
                        {l.t("留空自动跟随 Windows 系统代理（如 Clash Verge）与环境变量。")}
                      </p>
                    </div>
                    <div className="btn-row settings-feed-test-row" style={{ marginTop: 10, alignItems: "center" }}>
                      <button
                        type="button"
                        className="ghost-btn"
                        disabled={testingGallery}
                        onClick={() => {
                          setTestingGallery(true);
                          setGalleryTestMsg(null);
                          void apiFetchGalleryFeed(galleryConfig)
                            .then((items) => {
                              const okMsg = l.t("已拉取 {count} 张画廊图片", { count: items.length });
                              setGalleryTestMsg(okMsg);
                              pushToast(okMsg);
                            })
                            .catch((err) => {
                              const msg = err instanceof Error ? err.message : String(err);
                              setGalleryTestMsg(msg);
                              pushToast(msg, "error");
                            })
                            .finally(() => setTestingGallery(false));
                        }}
                      >
                        {testingGallery ? l.t("拉取中…") : l.t("测试拉取")}
                      </button>
                      {galleryTestMsg && (
                        <span className="hint" style={{ margin: 0, flex: 1, minWidth: 0 }}>{galleryTestMsg}</span>
                      )}
                    </div>
                  </>
                )}
              </div>
            </section>

            <section id="settings-notion" className="settings-card">
              <fieldset disabled={notionBusy || !hydrated} aria-busy={notionBusy} style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}>
                <h3 className="settings-card-title" style={{ marginBottom: 12 }}>{l.t("Notion 配置")}</h3>
                <div className="settings-grid-2">
                  <div className="field">
                    <label htmlFor="notion-token">{l.t("Notion Integration Token")}</label>
                    <input
                      id="notion-token"
                      type="password"
                      autoComplete="off"
                      placeholder="secret_..."
                      value={notion.token}
                      onChange={(e) => updateNotionDraft({ token: e.target.value })}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="notion-database">{l.t("Database ID")}</label>
                    <input
                      id="notion-database"
                      type="text"
                      placeholder={l.t("32-char database id")}
                      value={notion.databaseId}
                      onChange={(e) => updateNotionDraft({ databaseId: e.target.value })}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="notion-done">{l.t("完成属性名（checkbox）")}</label>
                    <input
                      id="notion-done"
                      type="text"
                      value={notion.doneProperty}
                      onChange={(e) =>
                        updateNotionDraft({ doneProperty: e.target.value })
                      }
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="notion-status">{l.t("Status 属性名（连带更新；留空跳过）")}</label>
                    <input
                      id="notion-status"
                      type="text"
                      value={notion.statusProperty}
                      onChange={(e) =>
                        updateNotionDraft({ statusProperty: e.target.value })
                      }
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="notion-status-done">{l.t("完成时 Status 值")}</label>
                    <input
                      id="notion-status-done"
                      type="text"
                      value={notion.statusDoneValue}
                      onChange={(e) =>
                        updateNotionDraft({ statusDoneValue: e.target.value })
                      }
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="notion-status-todo">{l.t("取消完成时 Status 值")}</label>
                    <input
                      id="notion-status-todo"
                      type="text"
                      value={notion.statusTodoValue}
                      onChange={(e) =>
                        updateNotionDraft({ statusTodoValue: e.target.value })
                      }
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="notion-date">{l.t("日期属性名")}</label>
                    <input
                      id="notion-date"
                      type="text"
                      value={notion.dateProperty}
                      onChange={(e) =>
                        updateNotionDraft({ dateProperty: e.target.value })
                      }
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="notion-title">{l.t("标题属性名")}</label>
                    <input
                      id="notion-title"
                      type="text"
                      value={notion.titleProperty}
                      onChange={(e) =>
                        updateNotionDraft({ titleProperty: e.target.value })
                      }
                    />
                  </div>
                </div>
                <p className="hint" style={{ marginTop: 10 }}>
                  {l.t("同步拉取：日期覆盖今天的任务。勾选时会写 checkbox（默认 done?），并连带更新 Status（默认 Done / Not started），对齐 Notion Button 自动化。")}</p>
              </fieldset>

              {message ? <div className="msg" role="status">{l.errorText(message)}</div> : null}
              {error ? <div className="msg error" role="alert">{l.errorText(error)}</div> : null}
              {notionConfirmation ? (
                <div
                  role="group"
                  aria-labelledby="notion-discard-title"
                  aria-describedby="notion-discard-description"
                  aria-busy={notionBusy}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      event.stopPropagation();
                      cancelNotionConfirmation();
                    }
                  }}
                >
                  <p id="notion-discard-title" role="alert">
                    {l.t("尚有 {count} 项未回写", { count: notionConfirmation.pendingCount })}
                  </p>
                  <p id="notion-discard-description">
                    {l.t("切换配置会放弃这些本地待写意图。若数量发生变化，需要重新确认。")}</p>
                  <div className="btn-row">
                    <button type="button" className="ghost-btn" disabled={notionBusy} onClick={cancelNotionConfirmation}>
                      {l.t("取消")}</button>
                    <button type="button" className="primary-btn" disabled={notionBusy} onClick={() => void discardPendingAndSaveNotion()}>
                      {notionOperation === "saving" ? l.t("保存中…") : l.t("放弃待写并保存")}
                    </button>
                  </div>
                </div>
              ) : null}

              <div className="btn-row">
                <button
                  type="button"
                  className="primary-btn"
                  disabled={!hydrated || notionBusy || notionConfirmation !== null}
                  onClick={() => void saveNotion()}
                >
                  {notionOperation === "saving" ? l.t("保存中…") : l.t("保存")}
                </button>
                <button
                  type="button"
                  className="ghost-btn"
                  disabled={!hydrated || notionBusy || notionConfirmation !== null}
                  onClick={() => void testNotion()}
                >
                  {notionOperation === "testing" ? l.t("测试中…") : l.t("测试连接")}
                </button>
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
