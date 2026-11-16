import { useLocale } from "../stores/languageStore";
import { useEffect, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { apiGetAutostartEnabled, apiSetAutostartEnabled } from "../services/tauriApi";

export function AutostartSettings() {
  const l = useLocale();
  const supported = isTauri();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(supported);
  const [error, setError] = useState("");
  const [readVersion, setReadVersion] = useState(0);

  useEffect(() => {
    if (!supported) return;
    let active = true;
    apiGetAutostartEnabled()
      .then((value) => {
        if (active) setEnabled(value);
      })
      .catch((reason: unknown) => {
        if (active) setError(`无法读取自启动状态：${String(reason)}`);
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => { active = false; };
  }, [supported, readVersion]);

  async function changeEnabled(next: boolean) {
    setBusy(true);
    setError("");
    try {
      const actual = await apiSetAutostartEnabled(next);
      setEnabled(actual);
      if (actual !== next) setError(l.t("系统未应用自启动设置，请重试。"));
    } catch (reason: unknown) {
      setEnabled(null);
      setError(`无法更新自启动设置：${String(reason)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <div className="field">
        <label className="check-row">
          <input
            type="checkbox"
            role="switch"
            checked={enabled === true}
            disabled={!supported || busy || enabled === null}
            onChange={(event) => void changeEnabled(event.target.checked)}
            aria-describedby="autostart-hint"
          />
          {l.t("开机自动启动")}</label>
        <p id="autostart-hint" className="hint" style={{ marginTop: 6 }}>
          {!supported ? l.t("仅桌面应用支持，浏览器预览不可设置。")
            : busy ? l.t("正在读取或更新系统设置…")
            : enabled === null ? l.t("暂时无法确认系统自启动状态。")
            : enabled ? l.t("已开启：登录 Windows 后自动打开便签。")
            : l.t("已关闭：仅手动打开便签。开启后对当前 Windows 用户生效，无需管理员权限。")}
        </p>
        {error ? (
          <div className="msg error" role="alert">
            {l.errorText(error)}{" "}
            <button type="button" className="ghost-btn" disabled={busy} onClick={() => {
              setError("");
              setBusy(true);
              setReadVersion((version) => version + 1);
            }}>{l.t("重新读取")}</button>
          </div>
        ) : null}
      </div>
    </section>
  );
}
