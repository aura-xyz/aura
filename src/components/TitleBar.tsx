import { getVersion } from "@tauri-apps/api/app";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Minus, Square, X } from "lucide-react";
import { useEffect, useState } from "react";

const appWindow = getCurrentWindow();

const IS_MAC =
  typeof navigator !== "undefined" && /Macintosh/.test(navigator.platform ?? "");

export default function TitleBar() {
  const [version, setVersion] = useState("");

  useEffect(() => {
    getVersion()
      .then((v) => setVersion(v))
      .catch(() => setVersion("0.7.2-rc.2"));
  }, []);

  const darwin = IS_MAC;
  const height = darwin ? "h-10" : "h-9";

  return (
    <header
      data-tauri-drag-region
      data-platform={darwin ? "darwin" : "windows"}
      className={`flex shrink-0 select-none items-center justify-between ${height} pl-4 pr-2`}
      style={{
        backgroundColor: "var(--chrome-bg)",
        color: "var(--dsw-alias-label-primary)",
      }}
    >
      <div data-tauri-drag-region className="flex items-baseline gap-2">
        <span className="text-[13px] font-semibold tracking-[-0.02em]">
          Aura
        </span>
        <span className="font-mono text-[11px] text-subtle">v{version}</span>
      </div>

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
          className="flex h-full w-10 items-center justify-center text-subtle transition-colors hover:bg-danger hover:text-white dark:hover:text-surface"
        >
          <X size={13} />
        </button>
      </div>
    </header>
  );
}
