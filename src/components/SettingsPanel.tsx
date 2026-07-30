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
  if (ids.length === 0) return null;
  return (
    <div className="theme-grid theme-grid-wide">
      {ids.map((id) => (
        <button
          key={id}
          type="button"
          className={`theme-card${active === id ? " active" : ""}`}
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
          {themes[id].label}
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
  const isActive = systemMode === mode;
  const title = mode === "light" ? "浅色主题" : "深色主题";
  const groups = [
    { key: "flat" as const, label: "扁平" },
    { key: "layered" as const, label: "层级卡片" },
    { key: "motion" as const, label: "动效" },
  ];

  return (
    <div className={`theme-mode-section${isActive ? " is-system-active" : ""}`}>
      <div className="theme-mode-header">
        <label>{title}</label>
        {isActive ? <span className="theme-mode-badge">当前系统</span> : null}
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
  const theme = useSettingsStore((s) => s.theme);
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
  const saving = useSettingsStore((s) => s.saving);
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

  return (
    <div className="settings-panel">
      <header className="settings-header" data-tauri-drag-region>
        <h2 data-tauri-drag-region>设置</h2>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="关闭">
          ✕
        </button>
      </header>

      <div className="settings-body">
        <section>
          <p className="hint" style={{ marginBottom: 12 }}>
            已按浅色 / 深色分类。默认浅色「Classic Paper」、深色「Dark OLED」；
            实际显示会跟随系统外观自动切换。当前生效：
            <strong style={{ marginLeft: 4 }}>{themes[theme]?.label ?? theme}</strong>
          </p>
          <ModeThemeSection
            mode="light"
            selected={lightTheme}
            systemMode={systemMode}
            onPick={(id) => void setLightThemeLocal(id)}
          />
          <ModeThemeSection
            mode="dark"
            selected={darkTheme}
            systemMode={systemMode}
            onPick={(id) => void setDarkThemeLocal(id)}
          />
        </section>

        <section>
          <div className="field">
            <label>字体</label>
            <select
              value={font}
              onChange={(e) => void setFontLocal(e.target.value as FontId)}
              style={{ fontFamily: fonts[font]?.family }}
            >
              {fontIds.map((id) => (
                <option key={id} value={id} style={{ fontFamily: fonts[id].family }}>
                  {fonts[id].label}
                </option>
              ))}
            </select>
            <p className="hint" style={{ marginTop: 6 }}>
              预览：
              <span style={{ fontFamily: fonts[font]?.family, marginLeft: 6 }}>
                今日待办 · Sticky Note
              </span>
            </p>
          </div>
        </section>

        <section>
          <div className="field">
            <label>贴边特效</label>
            <select
              value={fxTheme}
              onChange={(e) =>
                void setFxThemeLocal(e.target.value as FxThemeId)
              }
            >
              {fxThemeIds.map((id) => (
                <option key={id} value={id}>
                  {fxThemes[id].label}
                </option>
              ))}
            </select>
            <p className="hint" style={{ marginTop: 6 }}>
              生长：叶片 / 樱花 / 藤蔓 / 冰锥 / 墨迹；氛围：雨滴 / 雪花 / 萤火。
            </p>
          </div>
          <div className="field" style={{ marginTop: 12 }}>
            <label>
              特效强度{" "}
              <span style={{ opacity: 0.65 }}>
                {Math.round(fxIntensity * 100)}%
              </span>
            </label>
            <input
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
              控制粒子密度与整体可见度；浅色便签会自动略加强对比。
            </p>
          </div>
          <div className="field" style={{ marginTop: 12 }}>
            <label className="check-row">
              <input
                type="checkbox"
                checked={fxEdgeBoost}
                onChange={(e) => void setFxEdgeBoostLocal(e.target.checked)}
              />
              边缘高对比
            </label>
            <p className="hint" style={{ marginTop: 6 }}>
              只加强贴边 fringe / 近景粒子，避免整窗糊成雨幕。
            </p>
          </div>
        </section>

        <section>
          <div className="field">
            <label>贴边扶手</label>
            <select
              value={dockHandle}
              onChange={(e) =>
                void setDockHandleLocal(e.target.value as DockHandleId)
              }
            >
              {dockHandleIds.map((id) => (
                <option key={id} value={id}>
                  {dockHandles[id].label}
                </option>
              ))}
            </select>
            <p className="hint" style={{ marginTop: 6 }}>
              {dockHandles[dockHandle]?.hint}
            </p>
          </div>
        </section>

        <section>
          <div className="field">
            <label>Notion Integration Token</label>
            <input
              type="password"
              autoComplete="off"
              placeholder="secret_..."
              value={notion.token}
              onChange={(e) => updateNotionDraft({ token: e.target.value })}
            />
          </div>
          <div className="field" style={{ marginTop: 10 }}>
            <label>Database ID</label>
            <input
              type="text"
              placeholder="32-char database id"
              value={notion.databaseId}
              onChange={(e) => updateNotionDraft({ databaseId: e.target.value })}
            />
          </div>
          <div className="field" style={{ marginTop: 10 }}>
            <label>完成属性名（checkbox）</label>
            <input
              type="text"
              value={notion.doneProperty}
              onChange={(e) =>
                updateNotionDraft({ doneProperty: e.target.value })
              }
            />
          </div>
          <div className="field" style={{ marginTop: 10 }}>
            <label>Status 属性名（连带更新；留空跳过）</label>
            <input
              type="text"
              value={notion.statusProperty}
              onChange={(e) =>
                updateNotionDraft({ statusProperty: e.target.value })
              }
            />
          </div>
          <div className="field" style={{ marginTop: 10 }}>
            <label>完成时 Status 值</label>
            <input
              type="text"
              value={notion.statusDoneValue}
              onChange={(e) =>
                updateNotionDraft({ statusDoneValue: e.target.value })
              }
            />
          </div>
          <div className="field" style={{ marginTop: 10 }}>
            <label>取消完成时 Status 值</label>
            <input
              type="text"
              value={notion.statusTodoValue}
              onChange={(e) =>
                updateNotionDraft({ statusTodoValue: e.target.value })
              }
            />
          </div>
          <div className="field" style={{ marginTop: 10 }}>
            <label>日期属性名</label>
            <input
              type="text"
              value={notion.dateProperty}
              onChange={(e) =>
                updateNotionDraft({ dateProperty: e.target.value })
              }
            />
          </div>
          <div className="field" style={{ marginTop: 10 }}>
            <label>标题属性名</label>
            <input
              type="text"
              value={notion.titleProperty}
              onChange={(e) =>
                updateNotionDraft({ titleProperty: e.target.value })
              }
            />
          </div>
          <p className="hint" style={{ marginTop: 8 }}>
            同步拉取：日期覆盖今天的任务。勾选时会写 checkbox（默认 done?），并连带更新
            Status（默认 Done / Not started），对齐 Notion Button 自动化。
          </p>
        </section>

        {message ? <div className="msg">{message}</div> : null}
        {error ? <div className="msg error">{error}</div> : null}

        <div className="btn-row">
          <button
            type="button"
            className="primary-btn"
            disabled={saving}
            onClick={() => void saveNotion()}
          >
            保存
          </button>
          <button
            type="button"
            className="ghost-btn"
            disabled={saving}
            onClick={() => void testNotion()}
          >
            测试连接
          </button>
        </div>
      </div>
    </div>
  );
}
