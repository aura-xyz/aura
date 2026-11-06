/**
 * 「在…中打开」拆分按钮（v0.8.0）。
 *
 * 左半边直接用记住的应用打开，右半边 chevron 才展开菜单 —— 与 dsh
 * ui-open-in-app 的 split button 一致：默认动作一步到位，换应用才需要菜单。
 * 菜单走 portal + fixed 定位并钳在视口内：按钮贴着窗口右上角，普通
 * absolute 下拉会纵向伸出窗口、横向被裁掉（实测反馈）。
 *
 * 图标来源：资源管理器由 ico-extract 从 imageres.dll.mun 提取，
 * VS Code 由 public/icons 提供，JetBrains 全部来自 @jetbrains/logos。
 * 打开目录由后端按会话取，组件只传 sessionId。
 */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
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
import { useAnchoredPanel } from "../hooks/useAnchoredPanel";

const CHOICE_KEY = "aura-open-in-app-choice";

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

function loadChoice(): string {
  try {
    return localStorage.getItem(CHOICE_KEY) ?? "";
  } catch {
    return "";
  }
}

function saveChoice(id: string): void {
  try {
    localStorage.setItem(CHOICE_KEY, id);
  } catch {
    /* localStorage 不可用只影响下次启动的默认项 */
  }
}

interface Props {
  sessionId: string;
  /** 当前会话工作区；未选定时按钮禁用 */
  workspace: string;
}

export default function OpenInMenu({ sessionId, workspace }: Props) {
  const [apps, setApps] = useState<OpenApp[]>([]);
  const [choice, setChoice] = useState(loadChoice);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const anchorRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const pos = useAnchoredPanel(anchorRef, panelRef, open, "bottom");

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
      const target = e.target as Node;
      if (
        !anchorRef.current?.contains(target) &&
        !panelRef.current?.contains(target)
      ) {
        setOpen(false);
      }
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

  /** 记住的选择失效（应用被卸载）时回退到列表第一个。 */
  const preferred = apps.find((a) => a.id === choice) ?? apps[0];
  const disabled = !workspace || apps.length === 0;

  async function openWith(id: string) {
    setOpen(false);
    setError(null);
    try {
      await openInApp(id, sessionId);
    } catch (e) {
      setError(typeof e === "string" ? e : "打开失败，请检查应用是否已安装");
    }
  }

  function choose(app: OpenApp) {
    saveChoice(app.id);
    setChoice(app.id);
    void openWith(app.id);
  }

  return (
    <div ref={anchorRef} className="relative shrink-0">
      <div className="inline-flex items-center rounded-tag border border-line bg-bubble text-subtle">
        <button
          type="button"
          disabled={disabled}
          onClick={() => preferred && void openWith(preferred.id)}
          aria-label={preferred ? `用 ${preferred.name} 打开` : "在…中打开"}
          title={
            workspace
              ? preferred
                ? `用 ${preferred.name} 打开当前工作区`
                : "在…中打开当前工作区"
              : "请先选择工作区"
          }
          className="flex items-center px-1.5 py-1 transition-colors enabled:hover:bg-surface enabled:hover:text-foreground disabled:opacity-40"
        >
          <img
            src={APP_ICONS[preferred?.id ?? "explorer"] ?? APP_ICONS.explorer}
            alt=""
            className="h-4 w-4"
            draggable={false}
          />
        </button>
        <span className="h-4 w-px bg-line" aria-hidden />
        <button
          type="button"
          disabled={disabled}
          onClick={() => setOpen((v) => !v)}
          aria-label="选择打开方式"
          title="选择打开方式"
          aria-haspopup="menu"
          aria-expanded={open}
          className="flex items-center px-1 py-1 transition-colors enabled:hover:bg-surface enabled:hover:text-foreground disabled:opacity-40"
        >
          <ChevronDown size={12} aria-hidden />
        </button>
      </div>

      {open &&
        createPortal(
          <div
            ref={panelRef}
            role="menu"
            aria-label="选择打开方式"
            style={pos}
            className="max-h-[min(360px,calc(100vh-24px))] w-56 overflow-y-auto rounded-card border border-line bg-surface p-1 shadow-lg"
          >
            {apps.map((app) => (
              <button
                key={app.id}
                type="button"
                role="menuitem"
                onClick={() => choose(app)}
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
                  {app.id === preferred?.id && (
                    <span className="ml-1 text-[11px] text-subtle">（默认）</span>
                  )}
                </span>
              </button>
            ))}
          </div>,
          document.body,
        )}
      {error && (
        <p
          role="alert"
          className="absolute right-0 top-full z-50 mt-1 w-56 rounded-tag border border-danger bg-surface px-2 py-1 text-[11px] text-danger"
        >
          {error}
        </p>
      )}
    </div>
  );
}
