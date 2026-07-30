import React from "react";
import ReactDOM from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import App from "./App";
import { FxHost } from "./fx";
import "./styles.css";

const label = getCurrentWindow().label;

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {label === "fx" ? <FxHost /> : <App />}
  </React.StrictMode>,
);
