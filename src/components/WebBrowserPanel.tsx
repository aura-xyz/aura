/**
 * 右侧内置网页浏览面板（v0.8.0）。
 *
 * 用 iframe 承载网页，自带地址栏、前进/后退、刷新与「在系统浏览器打开」。
 * iframe 无法读取跨域历史，因此前进/后退走**面板自己的访问栈**。
 *
 * 已知限制：不少站点用 X-Frame-Options / CSP frame-ancestors 拒绝被嵌入。
 * 跨域 iframe 不会把失败原因交回来，只能靠「迟迟没有 onLoad」判定，
 * 因此超时后给出「在系统浏览器打开」的出口，而不是让用户对着白屏猜。
 */
import { useEffect, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  ExternalLink,
  Globe,
  RotateCw,
  ShieldOff,
} from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { normalizeBrowserUrl } from "../lib/browser";

/** iframe 的加载状态；`blocked` 是超时推断，不是浏览器给的明确信号。 */
type LoadState = "loading" | "ready" | "blocked";

/** 超过这个时长仍无 onLoad，就认为站点拒绝被嵌入。 */
const LOAD_TIMEOUT_MS = 8000;

export function WebBrowserPanel() {
  const [history, setHistory] = useState<string[]>([]);
  const [index, setIndex] = useState(-1);
  const [input, setInput] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [loadState, setLoadState] = useState<LoadState>("loading");

  const current = index >= 0 ? history[index] : "";
  const canBack = index > 0;
  const canForward = index >= 0 && index < history.length - 1;

  // 每次换页或刷新都重置加载态并重新计时：上一次的超时不能宣告新页面的死刑。
  useEffect(() => {
    if (!current) return;
    setLoadState("loading");
    const timer = window.setTimeout(() => {
      setLoadState((state) => (state === "loading" ? "blocked" : state));
    }, LOAD_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [current, reloadKey]);

  function openExternal(url: string) {
    void openUrl(url).catch(() => {});
  }

  function reload() {
    setReloadKey((k) => k + 1);
  }

  function navigate(raw: string) {
    const url = normalizeBrowserUrl(raw);
    if (!url) return;
    setInput(url);
    if (url === current) {
      reload();
      return;
    }
    setHistory((h) => [...h.slice(0, index + 1), url]);
    setIndex(index + 1);
  }

  function back() {
    if (!canBack) return;
    const next = index - 1;
    setIndex(next);
    setInput(history[next]);
  }

  function forward() {
    if (!canForward) return;
    const next = index + 1;
    setIndex(next);
    setInput(history[next]);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* 工具栏 */}
      <div className="flex shrink-0 items-center gap-0.5 border-b border-line px-1 py-1">
        <button
          type="button"
          onClick={back}
          disabled={!canBack}
          aria-label="后退"
          title="后退"
          className="rounded-tag p-1 text-subtle transition-colors enabled:hover:bg-bubble enabled:hover:text-foreground disabled:opacity-30"
        >
          <ArrowLeft size={13} />
        </button>
        <button
          type="button"
          onClick={forward}
          disabled={!canForward}
          aria-label="前进"
          title="前进"
          className="rounded-tag p-1 text-subtle transition-colors enabled:hover:bg-bubble enabled:hover:text-foreground disabled:opacity-30"
        >
          <ArrowRight size={13} />
        </button>
        <button
          type="button"
          onClick={reload}
          disabled={!current}
          aria-label="刷新"
          title="刷新"
          className="rounded-tag p-1 text-subtle transition-colors enabled:hover:bg-bubble enabled:hover:text-foreground disabled:opacity-30"
        >
          <RotateCw size={12} />
        </button>
        <form
          className="mx-1 flex min-w-0 flex-1"
          onSubmit={(e) => {
            e.preventDefault();
            navigate(input);
          }}
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="输入网址或搜索…"
            aria-label="网址"
            spellCheck={false}
            className="min-w-0 flex-1 rounded-tag border border-line bg-surface px-2 py-1 text-[11px] outline-none transition-colors placeholder:text-subtle focus:border-brand"
          />
        </form>
        <button
          type="button"
          onClick={() => {
            if (current) openExternal(current);
          }}
          disabled={!current}
          aria-label="在系统浏览器打开"
          title="在系统浏览器打开"
          className="rounded-tag p-1 text-subtle transition-colors enabled:hover:bg-bubble enabled:hover:text-foreground disabled:opacity-30"
        >
          <ExternalLink size={12} />
        </button>
      </div>

      {/* 内容 */}
      {current ? (
        <div className="relative min-h-0 flex-1">
          <iframe
            key={`${current}-${reloadKey}`}
            src={current}
            title="内置浏览器"
            onLoad={() => setLoadState("ready")}
            // bg-surface 而非 bg-white：暗色下白色底块比白屏还刺眼。
            className="h-full w-full border-0 bg-surface"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
            referrerPolicy="no-referrer"
          />
          {loadState === "loading" && <LoadingSkeleton />}
          {loadState === "blocked" && (
            <BlockedGuide url={current} onOpen={openExternal} />
          )}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-4 text-center">
          <Globe size={28} className="text-subtle" />
          <p className="text-[12px] text-subtle">
            输入网址开始浏览，或直接输入关键词搜索。
          </p>
          <p className="text-[11px] leading-relaxed text-subtle">
            部分站点禁止被嵌入，会显示空白——可用右上角在系统浏览器打开。
          </p>
        </div>
      )}
    </div>
  );
}

/** 加载骨架：顶部 2px 品牌色进度条 + 几行占位块，遮住 iframe 的纯白空窗。 */
function LoadingSkeleton() {
  return (
    <div
      role="status"
      aria-label="正在加载网页"
      className="absolute inset-0 flex flex-col gap-3 bg-surface px-4 py-5"
    >
      <div className="absolute inset-x-0 top-0 h-0.5 overflow-hidden bg-surface-sunken">
        <div className="aura-progress-bar h-full w-1/3 bg-brand" />
      </div>
      <div className="h-4 w-1/3 animate-pulse rounded-tag bg-surface-sunken" />
      <div className="h-3 w-4/5 animate-pulse rounded-tag bg-surface-sunken" />
      <div className="h-3 w-3/5 animate-pulse rounded-tag bg-surface-sunken" />
      <div className="mt-1 h-24 w-full animate-pulse rounded-tag bg-surface-sunken" />
    </div>
  );
}

/** 超时引导：告诉用户是被站点拒绝，而不是网络断了或 Aura 坏了。 */
function BlockedGuide({
  url,
  onOpen,
}: {
  url: string;
  onOpen: (url: string) => void;
}) {
  return (
    <div
      role="alert"
      className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-surface px-6 text-center"
    >
      <ShieldOff size={26} className="text-subtle" aria-hidden />
      <p className="text-[13px] font-medium">该站点拒绝嵌入</p>
      <p className="max-w-[260px] text-[11px] leading-relaxed text-subtle">
        多数站点用 X-Frame-Options 或 CSP 禁止在第三方窗口打开，内置浏览器无法绕过。
      </p>
      <button
        type="button"
        onClick={() => onOpen(url)}
        className="mt-1 flex items-center gap-1.5 rounded-tag bg-brand px-2.5 py-1.5 text-[11px] font-medium text-white transition-opacity hover:opacity-90 dark:text-surface"
      >
        <ExternalLink size={12} aria-hidden />
        在系统浏览器打开
      </button>
    </div>
  );
}
