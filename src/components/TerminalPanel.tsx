/**
 * 右栏的终端面板（v0.8.0）。
 *
 * xterm 实例**不放进 React state**：打字机式的输出会不断触发重渲染，
 * 而 xterm 自己有内部的渲染循环，重渲染只会打断它。组件只负责
 * 「建实例 → 挂接收端 → 拆」，数据的流动走终端会话注册表。
 *
 * 尺寸用 FitAddon 自适应，但**不能**在标签页隐藏时 fit：
 * 隐藏容器的 clientWidth 是 0，fit 会算出 0 列并把 PTY 弄坏。
 * 所以尺寸变化交给 ResizeObserver，等容器真的有尺寸了再 fit。
 */
import { useEffect, useRef, useState } from "react";
import { Terminal as Xterm, type ITheme } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { RotateCcw } from "lucide-react";
import {
  attachTerminalSink,
  detachTerminalSink,
  disposeTerminalSession,
  ensureTerminalSession,
  resizeTerminalSession,
  sendTerminalInput,
  type TerminalStatus,
} from "../lib/terminalSessions";

interface Props {
  /** 会话 id：后端据此决定终端的工作目录 */
  sessionId: string;
  /** 终端 id（进程标识） */
  terminalId: string;
  /** 指定的 shell 路径；不给则用系统默认 */
  shellPath?: string;
  /** 标签是不是当前激活的 */
  active?: boolean;
}

/**
 * 从**根元素**的 CSS 变量读主题色（v0.8.1）。
 *
 * 旧实现取的是终端容器自己的 `backgroundColor` / `color`。那个 div 只有
 * `px-1 py-1`，没有背景色 → `getComputedStyle` 返回 `rgba(0, 0, 0, 0)`，
 * xterm 拿到「透明背景」后按纯黑渲染：亮色主题里挂着一块黑砖，
 * 字号也只有写死的 12px。现在统一读设计令牌，主题与字号都跟着设置走。
 */
function cssVar(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  return v || fallback;
}

/**
 * 主题包（v0.8.1）：背景/前景取设计令牌，ANSI 十六色**显式给出**。
 *
 * 不显式给的话，xterm 用内置的经典配色：亮色主题下亮黄（#ffff00）和
 * 亮白（#ffffff）在浅底上几乎看不见；`minimumContrastRatio` 能救一部分，
 * 但它改的是渲染后的对比度，色相全乱。这里给两套手挑的配色。
 */
function readTheme(): ITheme {
  const dark = document.documentElement.classList.contains("dark");
  const background = cssVar("--surface", dark ? "#0a0a0a" : "#ffffff");
  const foreground = cssVar("--foreground", dark ? "#f5f5f7" : "#3a3a3c");
  const brand = cssVar("--brand", dark ? "#4da3ff" : "#0066cc");
  const palette = dark
    ? {
        black: "#98989d",
        red: "#ff453a",
        green: "#30d158",
        yellow: "#ffd60a",
        blue: "#4da3ff",
        magenta: "#bf5af2",
        cyan: "#64d2ff",
        white: "#f5f5f7",
        brightBlack: "#c7c7cc",
        brightRed: "#ff6961",
        brightGreen: "#5ce672",
        brightYellow: "#ffe066",
        brightBlue: "#7ab8ff",
        brightMagenta: "#d9a0ff",
        brightCyan: "#9be7ff",
        brightWhite: "#ffffff",
      }
    : {
        black: "#3a3a3c",
        red: "#c40017",
        green: "#22603f",
        yellow: "#7a5200",
        blue: "#0059b3",
        magenta: "#5b3fbf",
        cyan: "#005f6b",
        white: "#8e8e93",
        brightBlack: "#6e6e73",
        brightRed: "#d70015",
        brightGreen: "#2f6b4a",
        brightYellow: "#8a5a00",
        brightBlue: "#0066cc",
        brightMagenta: "#7c5cff",
        brightCyan: "#006d77",
        brightWhite: "#1c1c1e",
      };
  return {
    background,
    foreground,
    cursor: foreground,
    cursorAccent: background,
    selectionBackground: hexAlpha(brand, 0.3),
    ...palette,
  };
}

/** 把 `#rrggbb` 转成带透明度的 rgba；非 hex（已是 rgb/var）时退回固定值。 */
function hexAlpha(hex: string, alpha: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return `rgba(0, 102, 204, ${alpha})`;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/** 终端字号跟随设置页（`--dsw-alias-font-size-terminal`），缺省 13px。 */
function readFontSize(): number {
  const raw = cssVar("--dsw-alias-font-size-terminal", "13px");
  const px = Number.parseFloat(raw);
  // 太小看不清、太大一行放不下：夹在 11 与 18 之间
  return Number.isFinite(px) ? Math.min(18, Math.max(11, px)) : 13;
}

export function TerminalPanel({ sessionId, terminalId, shellPath, active }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<TerminalStatus>("starting");
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  /** 当前 effect 里的尺寸测量函数。标签被激活时补调一次。 */
  const measureRef = useRef<(() => void) | null>(null);

  /**
   * 标签切回来时补一次测量。
   *
   * 隐藏的标签容器宽度是 0，ResizeObserver 在 display:none 下不一定会
   * 触发「变大」这一次，终端就会停留在旧列宽，右侧留白或折行错位。
   */
  useEffect(() => {
    if (!active) return;
    measureRef.current?.();
  }, [active]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    // 组件已经卸载就别再往里写状态
    let disposed = false;

    const xterm = new Xterm({
      fontSize: readFontSize(),
      fontFamily:
        "'Cascadia Mono', 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, 'Courier New', monospace",
      // 行高略松：终端里密集输出时，1.0 的行距读起来是一片黑影
      lineHeight: 1.35,
      letterSpacing: 0,
      cursorBlink: true,
      cursorStyle: "bar",
      scrollback: 5000,
      // 关掉透明背景：容器若没铺底，xterm 会按黑色填，暗色主题下看不出来、
      // 亮色主题下就是一块黑砖
      allowTransparency: false,
      minimumContrastRatio: 4.5,
      theme: readTheme(),
    });
    const fit = new FitAddon();
    xterm.loadAddon(fit);
    xterm.open(host);

    const input = xterm.onData((data) => {
      void sendTerminalInput(terminalId, data);
    });

    const measure = () => {
      // 标签页隐藏时容器宽度为 0，此时 fit 会算出 0 列并把 PTY 弄坏
      if (host.clientWidth === 0 || host.clientHeight === 0) return;
      try {
        fit.fit();
      } catch {
        return;
      }
      void resizeTerminalSession(terminalId, xterm.cols, xterm.rows);
    };

    const observer = new ResizeObserver(measure);
    observer.observe(host);
    measureRef.current = measure;

    // 主题或字号变了要重新上色：xterm 不会自己读 CSS 变量。
    // 监听 html 的 class/data-* 与 body 的 style（字号由 useTheme 写在 body 上）。
    const restyle = () => {
      xterm.options.theme = readTheme();
      xterm.options.fontSize = readFontSize();
      measure();
    };
    const themeObserver = new MutationObserver(restyle);
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "data-theme", "data-accent"],
    });
    themeObserver.observe(document.body, {
      attributes: true,
      attributeFilter: ["style", "class"],
    });

    let unwatch: (() => void) | null = null;

    void ensureTerminalSession({ id: terminalId, sessionId, shellPath }).then(
      (session) => {
        if (disposed) return;
        // 状态订阅要等会话真的建出来才有对象可订阅
        unwatch = session.watch((s) => {
          setStatus(s.status);
          setError(s.error ?? null);
        });
        // 挂上接收端：注册表会把此前的输出回放进来，屏幕得以恢复
        attachTerminalSink(terminalId, {
          write: (data) => {
            xterm.write(data);
          },
        });
        measure();
      },
    );

    return () => {
      disposed = true;
      observer.disconnect();
      themeObserver.disconnect();
      input.dispose();
      unwatch?.();
      measureRef.current = null;
      // 只摘接收端，**不结束进程**：收起右栏也会走到这里
      detachTerminalSink(terminalId);
      xterm.dispose();
    };
  }, [sessionId, terminalId, shellPath, attempt]);

  const busy = status === "starting";
  const dead = status === "exited" || status === "failed";

  return (
    <div className="relative flex min-h-0 flex-1 flex-col bg-surface">
      <div ref={hostRef} className="min-h-0 flex-1 px-2 py-1.5" />
      {busy && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-surface/80 text-[11px] text-subtle">
          正在启动终端…
        </div>
      )}
      {dead && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-surface/90 px-4 text-center">
          <p className="text-[11px] text-subtle">
            {status === "failed"
              ? (error ?? "终端启动失败")
              : "终端进程已退出"}
          </p>
          <button
            type="button"
            onClick={() => {
              // 旧会话已经死了，要先从注册表里摘掉，
              // 否则 ensureTerminalSession 会认为「它还在」而不重建。
              void disposeTerminalSession(terminalId).then(() =>
                setAttempt((v) => v + 1),
              );
            }}
            className="flex items-center gap-1 rounded-tag border border-line px-2 py-1 text-[11px] text-foreground transition-colors hover:bg-bubble"
          >
            <RotateCcw size={11} aria-hidden />
            重新启动
          </button>
        </div>
      )}
    </div>
  );
}

export default TerminalPanel;
