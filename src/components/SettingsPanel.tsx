import { useLocale } from "../stores/languageStore";
import { useEffect } from "react";
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
  const updateNotionDraft = useSettingsStore((s) => s.updateNotionDraft);
  const saveNotion = useSettingsStore((s) => s.saveNotion);
  const testNotion = useSettingsStore((s) => s.testNotion);
  const discardPendingAndSaveNotion = useSettingsStore((s) => s.discardPendingAndSaveNotion);
  const cancelNotionConfirmation = useSettingsStore((s) => s.cancelNotionConfirmation);

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

      <div className="settings-body">
        <LanguageSettings />
        <AutostartSettings />

        <fieldset disabled={!hydrated} aria-label={l.t("外观")} style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}>
        <section>
          <p className="hint" style={{ marginBottom: 12 }}>
            {l.t("已按浅色 / 深色分类。默认浅色「Classic Paper」、深色「Dark OLED」； 实际显示会跟随系统外观自动切换。当前生效：")}<strong style={{ marginLeft: 4 }}>{l.label(themes[theme]?.label ?? theme)}</strong>
          </p>
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
        </section>

        <section>
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
        </section>

        <section>
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
          <div className="field" style={{ marginTop: 12 }}>
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
          </div>
          <div className="field" style={{ marginTop: 12 }}>
            <label className="check-row">
              <input
                type="checkbox"
                checked={fxEdgeBoost}
                onChange={(e) => commitAppearance(() => setFxEdgeBoostLocal(e.target.checked))}
              />
              {l.t("边缘高对比")}</label>
            <p className="hint" style={{ marginTop: 6 }}>
              {l.t("只加强贴边 fringe / 近景粒子，避免整窗糊成雨幕。")}</p>
          </div>
        </section>

        <section>
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
        </section>
        </fieldset>

        <section>
          <fieldset disabled={notionBusy || !hydrated} aria-busy={notionBusy} style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}>
          <legend>{l.t("Notion 配置")}</legend>
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
          <div className="field" style={{ marginTop: 10 }}>
            <label htmlFor="notion-database">{l.t("Database ID")}</label>
            <input
              id="notion-database"
              type="text"
              placeholder={l.t("32-char database id")}
              value={notion.databaseId}
              onChange={(e) => updateNotionDraft({ databaseId: e.target.value })}
            />
          </div>
          <div className="field" style={{ marginTop: 10 }}>
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
          <div className="field" style={{ marginTop: 10 }}>
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
          <div className="field" style={{ marginTop: 10 }}>
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
          <div className="field" style={{ marginTop: 10 }}>
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
          <div className="field" style={{ marginTop: 10 }}>
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
          <div className="field" style={{ marginTop: 10 }}>
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
          <p className="hint" style={{ marginTop: 8 }}>
            {l.t("同步拉取：日期覆盖今天的任务。勾选时会写 checkbox（默认 done?），并连带更新 Status（默认 Done / Not started），对齐 Notion Button 自动化。")}</p>
          </fieldset>
        </section>

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
      </div>
    </div>
  );
}
