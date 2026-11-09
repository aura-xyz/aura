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

/** 终端配色跟随主题：背景/前景取当前配色，其余交给 xterm 默认 ANSI 盘。 */
function readTheme(host: HTMLElement): ITheme {
  const style = getComputedStyle(host);
  const background = style.backgroundColor;
  const foreground = style.color;
  return {
    background,
    foreground,
    cursor: foreground,
    // 选区用品牌色的半透明版；xterm 不接受 color-mix，用 rgba 固定值
    selectionBackground: "rgba(0, 102, 204, 0.35)",
  };
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
      fontSize: 12,
      fontFamily:
        "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Courier New', monospace",
      cursorBlink: true,
      scrollback: 5000,
      // 亮色主题下 ANSI 蓝/紫对比度不够，交给 xterm 按背景色自动调整
      minimumContrastRatio: 4.5,
      theme: readTheme(host),
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
      <div ref={hostRef} className="min-h-0 flex-1 px-1 py-1" />
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
