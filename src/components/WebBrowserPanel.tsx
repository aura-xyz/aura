/**
 * 右侧内置网页浏览面板（v0.8.0）。
 *
 * 用 iframe 承载网页，自带地址栏、前进/后退、刷新与「在系统浏览器打开」。
 * iframe 无法读取跨域历史，因此前进/后退走**面板自己的访问栈**。
 *
 * 已知限制：不少站点用 X-Frame-Options / CSP frame-ancestors 拒绝被嵌入，
 * 这类页面会白屏——提供系统浏览器出口兜底。
 */
import { useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  ExternalLink,
  Globe,
  RotateCw,
} from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { normalizeBrowserUrl } from "../lib/browser";

export function WebBrowserPanel() {
  const [history, setHistory] = useState<string[]>([]);
  const [index, setIndex] = useState(-1);
  const [input, setInput] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  const current = index >= 0 ? history[index] : "";
  const canBack = index > 0;
  const canForward = index >= 0 && index < history.length - 1;

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
            if (current) void openUrl(current).catch(() => {});
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
        <iframe
          key={`${current}-${reloadKey}`}
          src={current}
          title="内置浏览器"
          className="min-h-0 flex-1 border-0 bg-white"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
          referrerPolicy="no-referrer"
        />
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
