/**
 * 桌面平台判定（v0.8.0，C26 起）。
 *
 * 从 TitleBar 抽出来，因为除了标题栏按钮风格，根样式也要按平台分支
 * （Linux 无边框窗口需要透明 + CSS 圆角，Windows 由 DWM 自带圆角），
 * main.tsx 得在首帧前把平台写到 `<html data-platform>`。
 */
import { platform } from "@tauri-apps/plugin-os";

/** 三种桌面平台。Linux 单独一档：窗口按钮的悬停色与 mac 不同。 */
export type Desktop = "darwin" | "linux" | "windows";

/**
 * 首帧兜底：plugin-os 是异步的，取值回来之前先按 UA 猜一个，
 * 免得先按 Windows 画一遍、拿到结果再跳成 mac 布局。
 */
function guessDesktop(): Desktop {
  const p = typeof navigator === "undefined" ? "" : (navigator.platform ?? "");
  if (/Mac/i.test(p)) return "darwin";
  if (/Linux|X11/i.test(p)) return "linux";
  return "windows";
}

/** plugin-os 的返回值映射到三档；其余平台按 Windows 处理。 */
function fromPluginOs(value: string): Desktop {
  if (value === "macos" || value === "ios") return "darwin";
  if (value === "linux" || value === "android") return "linux";
  return "windows";
}

let cachedDesktop: Desktop | null = null;

/**
 * 解析平台。
 *
 * `platform()` 是同步的（插件在启动时就把平台塞进了前端），因此不需要
 * 首帧兜底猜测；仍然缓存一次，避免每次渲染都过一遍字符串映射。
 * 插件未注册 / 权限缺失时抛错，退回 UA 猜测，界面不至于卡在未知态。
 */
export function resolveDesktop(): Desktop {
  if (cachedDesktop) return cachedDesktop;
  try {
    cachedDesktop = fromPluginOs(String(platform()));
  } catch {
    cachedDesktop = guessDesktop();
  }
  return cachedDesktop;
}

/** 仅供测试：清掉缓存，让每个用例都能重新解析一次平台。 */
export function resetDesktopCache(): void {
  cachedDesktop = null;
}
