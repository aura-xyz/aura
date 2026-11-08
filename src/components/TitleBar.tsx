import { getVersion } from "@tauri-apps/api/app";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { platform } from "@tauri-apps/plugin-os";
import { Minus, Search, Square, X } from "lucide-react";
import { useEffect, useState } from "react";
import { APP_VERSION } from "../lib/version";

const appWindow = getCurrentWindow();

/** 三种桌面平台。Linux 单独一档：窗口按钮的悬停色与 mac 不同。 */
type Desktop = "darwin" | "linux" | "windows";

/**
 * 首帧兜底：plugin-os 是异步的，取值回来之前先按 UA 猜一个，
 * 免得先按 Windows 画一遍、拿到结果再跳成 mac 布局。
 */
function guessDesktop(): Desktop {
  const p =
    typeof navigator === "undefined" ? "" : (navigator.platform ?? "");
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

export default function TitleBar({ onSearch }: { onSearch?: () => void }) {
  // 首帧直接用构建期常量（同源自 package.json），避免先闪一个空的 "v"。
  const [version, setVersion] = useState(APP_VERSION);
  const [desktop] = useState<Desktop>(resolveDesktop);

  useEffect(() => {
    getVersion()
      .then((v) => setVersion(v))
      // 运行时版本读不出来就明说 "dev"，不要再兜底一个可能早已过期的版本号。
      .catch(() => setVersion("dev"));
  }, []);

  const isRc = /-rc\./i.test(version);
  const darwin = desktop === "darwin";
  // Linux 的窗口按钮由桌面环境统一管理风格，用淡色悬停而不是整块红。
  const linux = desktop === "linux";
  const height = darwin ? "h-10" : "h-9";
  // 右侧不留内边距：无边框窗口的关闭按钮必须贴到窗口边缘。
  // 原先的 pr-2 让红色按钮右边空出 8px（实测反馈），看着像被滚动条顶开。

  return (
    <header
      data-tauri-drag-region
      data-platform={desktop}
      className={`relative flex shrink-0 select-none items-center justify-between ${height} pl-4`}
      style={{
        backgroundColor: "var(--chrome-bg)",
        color: "var(--dsw-alias-label-primary)",
      }}
    >
      <div data-tauri-drag-region className="flex items-baseline gap-2">
        <span className="text-[13px] font-semibold tracking-[-0.02em]">
          Aura
        </span>
        <span className="font-mono text-[11px] text-subtle">
          {version === "dev" ? "dev" : `v${version}`}
        </span>
        {/* rc 期标出来：预发布通道的用户该知道自己在哪条通道上 */}
        {isRc && (
          <span className="rounded border border-brand/40 px-1 text-[9px] font-medium leading-[14px] text-brand">
            RC
          </span>
        )}
      </div>

      {/* 中部搜索位：把 Ctrl+K 这个隐藏快捷键变成看得见的入口。
          窄窗口下藏起来，否则会和右侧窗口按钮挤在一起。 */}
      {onSearch && (
        <button
          type="button"
          onClick={onSearch}
          title="搜索会话 · Ctrl + K"
          className="absolute left-1/2 hidden -translate-x-1/2 items-center gap-2 rounded-full border border-line bg-surface px-3 py-1 text-[11px] text-subtle transition-colors hover:border-brand hover:text-foreground md:flex"
        >
          <Search size={12} aria-hidden />
          <span>搜索会话、技能与命令</span>
          <kbd className="rounded border border-line px-1 text-[10px] leading-[14px]">
            Ctrl K
          </kbd>
        </button>
      )}

      <div className="flex h-full gap-0.5">
        <button
          type="button"
          onClick={() => appWindow.minimize()}
          aria-label="最小化"
          className="flex h-full w-10 items-center justify-center text-subtle transition-colors hover:bg-bubble hover:text-foreground"
        >
          <Minus size={13} />
        </button>
        <button
          type="button"
          onClick={() => appWindow.toggleMaximize()}
          aria-label="最大化"
          className="flex h-full w-10 items-center justify-center text-subtle transition-colors hover:bg-bubble hover:text-foreground"
        >
          <Square size={11} />
        </button>
        <button
          type="button"
          onClick={() => appWindow.close()}
          aria-label="关闭"
          className={`flex h-full w-10 items-center justify-center text-subtle transition-colors ${
            linux
              ? "hover:bg-danger/15 hover:text-danger"
              : "hover:bg-danger hover:text-white dark:hover:text-surface"
          }`}
        >
          <X size={13} />
        </button>
      </div>
    </header>
  );
}
