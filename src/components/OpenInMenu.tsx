/**
 * 「在…中打开」按钮：侧栏折叠按钮旁边，下拉列出本机已安装的应用。
 *
 * 图标来源：资源管理器由 ico-extract 从 imageres.dll.mun 提取，
 * VS Code 由 public/icons 提供，JetBrains 全部来自 @jetbrains/logos。
 * 打开目录由后端按会话取，组件只传 sessionId。
 */
import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import ideaUrl from "@jetbrains/logos/intellij-idea/intellij-idea.svg?url";
import pycharmUrl from "@jetbrains/logos/pycharm/pycharm.svg?url";
import webstormUrl from "@jetbrains/logos/webstorm/webstorm.svg?url";
import riderUrl from "@jetbrains/logos/rider/rider.svg?url";
import clionUrl from "@jetbrains/logos/clion/clion.svg?url";
import golandUrl from "@jetbrains/logos/goland/goland.svg?url";
import phpstormUrl from "@jetbrains/logos/phpstorm/phpstorm.svg?url";
import datagripUrl from "@jetbrains/logos/datagrip/datagrip.svg?url";
import androidStudioUrl from "@jetbrains/logos/android-studio/android-studio.svg?url";
import { listOpenApps, openInApp, type OpenApp } from "../lib/api";
import { normalizeOpenApps } from "../lib/openApps";

export const APP_ICONS: Record<string, string> = {
  explorer: "/icons/explorer.ico",
  vscode: "/icons/vscode.svg",
  idea: ideaUrl,
  pycharm: pycharmUrl,
  webstorm: webstormUrl,
  rider: riderUrl,
  clion: clionUrl,
  goland: golandUrl,
  phpstorm: phpstormUrl,
  datagrip: datagripUrl,
  androidstudio: androidStudioUrl,
};

interface Props {
  sessionId: string;
  /** 当前会话工作区；未选定时按钮禁用 */
  workspace: string;
}

export default function OpenInMenu({ sessionId, workspace }: Props) {
  const [apps, setApps] = useState<OpenApp[]>([]);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    // 包一层 Promise.resolve：测试环境的 Tauri mock 可能返回非 Promise 值
    Promise.resolve(listOpenApps())
      .then((list) => {
        if (!cancelled) setApps(normalizeOpenApps(list ?? []));
      })
      .catch(() => {
        if (!cancelled) setApps(normalizeOpenApps([]));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function choose(app: OpenApp) {
    setOpen(false);
    setError(null);
    try {
      await openInApp(app.id, sessionId);
    } catch (e) {
      setError(typeof e === "string" ? e : "打开失败，请检查应用是否已安装");
    }
  }

  const disabled = !workspace || apps.length === 0;

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        aria-label="在…中打开"
        title={workspace ? "在…中打开当前工作区" : "请先选择工作区"}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-1 rounded-tag border border-line bg-bubble px-1.5 py-1 text-subtle transition-colors enabled:hover:bg-surface enabled:hover:text-foreground disabled:opacity-40"
      >
        <img src={APP_ICONS.explorer} alt="" className="h-4 w-4" draggable={false} />
        <span className="h-4 w-px bg-line" aria-hidden />
        <ChevronDown size={12} aria-hidden />
      </button>

      {open && (
        <div
          role="menu"
          aria-label="选择打开方式"
          className="absolute left-0 top-full z-50 mt-1 w-56 rounded-card border border-line bg-surface p-1 shadow-lg"
        >
          {apps.map((app, index) => (
            <button
              key={app.id}
              type="button"
              role="menuitem"
              onClick={() => void choose(app)}
              className="flex w-full items-center gap-2 rounded-tag px-2 py-1.5 text-left text-[13px] text-foreground transition-colors hover:bg-bubble"
            >
              <img
                src={APP_ICONS[app.id] ?? APP_ICONS.explorer}
                alt=""
                className="h-4 w-4 shrink-0"
                draggable={false}
              />
              <span className="min-w-0 flex-1 truncate">
                {app.name}
                {index === 0 && (
                  <span className="ml-1 text-[11px] text-subtle">（默认）</span>
                )}
              </span>
            </button>
          ))}
        </div>
      )}
      {error && (
        <p
          role="alert"
          className="absolute left-0 top-full z-50 mt-1 w-56 rounded-tag border border-danger bg-surface px-2 py-1 text-[11px] text-danger"
        >
          {error}
        </p>
      )}
    </div>
  );
}
