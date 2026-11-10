import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import { resolveDesktop } from "./lib/platform";

// 首帧前把平台写到 <html data-platform>：根样式要按平台分支——
// Linux 的无边框窗口靠透明 + CSS 圆角，Windows 由 DWM 自带圆角。
document.documentElement.dataset.platform = resolveDesktop();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
