import { isTauri } from "@tauri-apps/api/core";
import type { LanguagePreference } from "../i18n";
import { useLanguageStore, useLocale } from "../stores/languageStore";

export function LanguageSettings() {
  const { t, errorText } = useLocale();
  const state = useLanguageStore();
  const native = isTauri();
  return (
    <section aria-busy={state.busy}>
      <div className="field">
        <label htmlFor="app-language">{t("语言")}</label>
        <select id="app-language" value={state.preference} disabled={state.busy || !state.hydrated}
          aria-describedby="language-hint"
          onChange={(event) => {
            const preference = event.target.value as LanguagePreference;
            void state.setPreference(preference);
          }}>
          <option value="auto">{t(native ? "自动（跟随 Windows）" : "自动（跟随浏览器）")}</option>
          <option value="zh-CN" lang="zh-CN">中文</option>
          <option value="en" lang="en">English</option>
        </select>
        <p id="language-hint" className="hint" style={{ marginTop: 6 }}>
          {t("当前语言：{language}", { language: state.effective === "zh-CN" ? "中文" : "English" })}
          {!native && <> · {t("浏览器预览：语言仅用于本次预览，不会保存到桌面应用。")}</>}
        </p>
        {state.busy ? <p role="status">{t(state.hydrated ? "语言正在保存…" : "正在读取语言…")}</p>
          : state.saved ? <p role="status">{t("语言已保存")}</p> : null}
        {state.error && <div className="msg error" role="alert">
          {t(state.failure === "load" ? "语言读取失败：{error}" : "语言保存失败：{error}", { error: errorText(state.error) })}
          <button type="button" className="ghost-btn" disabled={state.busy}
            onClick={() => void (state.failure === "load" ? state.hydrate() : state.setPreference(state.requestedPreference ?? state.preference))}>{t("重试")}</button>
        </div>}
      </div>
    </section>
  );
}
