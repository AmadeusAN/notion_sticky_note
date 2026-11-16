import React from "react";
import ReactDOM from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import "./styles.css";
import { translate } from "./i18n";
import { useLanguageStore } from "./stores/languageStore";

const label = "__TAURI_INTERNALS__" in window ? getCurrentWindow().label : "main";

const root = ReactDOM.createRoot(document.getElementById("root")!);
// The native window label selects its module at runtime; static imports load both graphs.
void (async () => {
  if (label !== "fx") await useLanguageStore.getState().hydrate();
  const Entry = label === "fx"
    ? (await import("./fx/FxHost")).FxHost
    : (await import("./App")).default;
  root.render(<React.StrictMode><Entry /></React.StrictMode>);
})().catch((error) => {
  console.error("Unable to load application window", error);
  root.render(<p role="alert">{translate(useLanguageStore.getState().effective, "应用加载失败，请重新启动。")}</p>);
});
