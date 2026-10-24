import { useEffect, useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  Copy,
  Download,
  History,
  Search,
  Terminal,
} from "lucide-react";
import {
  exportTimeline,
  listTimeline,
  type TimelineEntry,
  type TimelineKind,
} from "../lib/api";
import { useStore } from "../store";

/** 类型 → 图标与配色。 */
const KIND_META: Record<
  TimelineKind,
  { icon: typeof Terminal; cls: string }
> = {
  user: { icon: CircleCheck, cls: "text-brand" },
  assistant: { icon: CircleCheck, cls: "text-foreground" },
  tool: { icon: Terminal, cls: "text-subtle" },
  denied: { icon: CircleAlert, cls: "text-danger" },
  context: { icon: History, cls: "text-subtle" },
  todo: { icon: CircleCheck, cls: "text-subtle" },
  error: { icon: CircleAlert, cls: "text-danger" },
  notice: { icon: CircleCheck, cls: "text-subtle" },
};

const KIND_LABEL: Record<TimelineKind, string> = {
  user: "用户",
  assistant: "助手",
  tool: "工具",
  denied: "拒绝",
  context: "上下文",
  todo: "清单",
  error: "错误",
  notice: "提示",
};

/** 毫秒时间戳 → 本地时间 `HH:MM:SS`。 */
function fmtTime(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** 毫秒 → 「1.2s」/「340ms」。 */
function fmtDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/**
 * 操作时间线（v0.6.2）。
 *
 * 记录模型在本次会话里的**全部操作**——不只是对话里留下的文字，
 * 还有每次工具调用的参数、结果与耗时，以及被拒绝的动作。
 *
 * 按轮次分组：同一轮的模型输出与工具调用放在一起，
 * 这样能看出「模型为什么调了这个工具」。
 *
 * **对话级隔离**：数据按 session_id 取，切换会话时间线随之切换。
 */
export default function TimelinePage({ onClose }: { onClose: () => void }) {
  const { sessions, activeId } = useStore();
  const [entries, setEntries] = useState<TimelineEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  /** 折叠的轮次。空 = 全部展开。 */
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  /** 展开详情的条目 seq。 */
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [copied, setCopied] = useState(false);

  const activeSession = sessions.find((s) => s.id === activeId);

  useEffect(() => {
    if (!activeId) {
      setEntries([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    listTimeline(activeId)
      .then((rows) => {
        setEntries(rows);
        setLoading(false);
      })
      .catch((e) => {
        setError(String(e));
        setLoading(false);
      });
  }, [activeId]);

  /** 按关键词过滤（标题或详情）。 */
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter(
      (e) =>
        e.title.toLowerCase().includes(q) ||
        (e.detail ?? "").toLowerCase().includes(q),
    );
  }, [entries, query]);

  /** 按轮次分组。 */
  const groups = useMemo(() => {
    const map = new Map<number, TimelineEntry[]>();
    for (const e of filtered) {
      const list = map.get(e.turn) ?? [];
      list.push(e);
      map.set(e.turn, list);
    }
    return [...map.entries()].sort((a, b) => a[0] - b[0]);
  }, [filtered]);

  const stats = useMemo(() => {
    let tools = 0;
    let errors = 0;
    let denied = 0;
    let toolMs = 0;
    for (const e of filtered) {
      if (e.kind === "tool") {
        tools += 1;
        toolMs += e.duration_ms ?? 0;
      } else if (e.kind === "error") {
        errors += 1;
      } else if (e.kind === "denied") {
        denied += 1;
      }
    }
    return { turns: groups.length, tools, errors, denied, toolMs };
  }, [filtered, groups]);

  async function copyMarkdown() {
    if (!activeId) return;
    const md = await exportTimeline(activeId, activeSession?.title);
    await navigator.clipboard.writeText(md);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function downloadMarkdown() {
    if (!activeId) return;
    const md = await exportTimeline(activeId, activeSession?.title);
    const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `timeline-${activeSession?.title || activeId}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function toggleTurn(turn: number) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(turn)) {
        next.delete(turn);
      } else {
        next.add(turn);
      }
      return next;
    });
  }

  function toggleDetail(seq: number) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(seq)) {
        next.delete(seq);
      } else {
        next.add(seq);
      }
      return next;
    });
  }

  return (
    <div className="mx-auto flex h-full w-full max-w-4xl flex-col px-6 py-6">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-sm font-semibold">操作时间线</h1>
          <p className="mt-1 text-xs text-subtle">
            {activeSession
              ? `「${activeSession.title}」的全部操作记录`
              : "当前没有选中的会话"}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={() => void copyMarkdown()}
            disabled={!activeId || entries.length === 0}
            className="flex items-center gap-1 rounded-md border border-line px-2 py-1 text-[11px] text-subtle transition-colors hover:border-brand hover:text-brand disabled:opacity-40"
          >
            <Copy size={11} />
            {copied ? "已复制" : "复制 Markdown"}
          </button>
          <button
            type="button"
            onClick={() => void downloadMarkdown()}
            disabled={!activeId || entries.length === 0}
            className="flex items-center gap-1 rounded-md border border-line px-2 py-1 text-[11px] text-subtle transition-colors hover:border-brand hover:text-brand disabled:opacity-40"
          >
            <Download size={11} />
            导出
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-line px-2.5 py-1 text-[11px] text-subtle transition-colors hover:border-brand hover:text-brand"
          >
            返回对话
          </button>
        </div>
      </div>

      {/* 统计概览 */}
      {entries.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-card border border-line px-3 py-2 text-[11px] text-subtle">
          <span>{stats.turns} 轮</span>
          <span>{stats.tools} 次工具调用</span>
          <span>{stats.errors} 次错误</span>
          <span>{stats.denied} 次拒绝</span>
          <span>工具耗时 {fmtDuration(stats.toolMs)}</span>
        </div>
      )}

      {/* 过滤条 */}
      {entries.length > 0 && (
        <div className="relative mt-3">
          <Search
            size={13}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-subtle"
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索工具名、参数或结果"
            aria-label="搜索时间线"
            className="w-full rounded-card border border-line bg-surface py-2 pl-8 pr-3 text-sm outline-none transition-colors focus:border-brand"
          />
        </div>
      )}

      <div className="mt-4 min-h-0 flex-1 overflow-y-auto pb-8">
        {loading && <p className="text-xs text-subtle">读取中…</p>}
        {error && <p className="text-xs text-danger">{error}</p>}
        {!loading && !error && entries.length === 0 && (
          <p className="text-xs text-subtle">
            这个会话还没有操作记录。发一条消息后就会出现在这里。
          </p>
        )}
        {!loading && !error && entries.length > 0 && groups.length === 0 && (
          <p className="text-xs text-subtle">没有匹配的记录。</p>
        )}

        {groups.map(([turn, items]) => {
          const isCollapsed = collapsed.has(turn);
          return (
            <section key={turn} className="mb-3">
              <button
                type="button"
                onClick={() => toggleTurn(turn)}
                aria-expanded={!isCollapsed}
                className="flex w-full items-center gap-1.5 rounded-card px-1 py-1 text-left text-xs font-medium text-subtle transition-colors hover:text-foreground"
              >
                {isCollapsed ? (
                  <ChevronRight size={12} className="shrink-0" />
                ) : (
                  <ChevronDown size={12} className="shrink-0" />
                )}
                {turn === 0 ? "对话开始" : `第 ${turn} 轮`}
                <span className="font-normal opacity-70">
                  {items.length} 条
                </span>
              </button>

              {!isCollapsed && (
                <ul className="mt-1 flex flex-col gap-1 border-l border-line pl-3">
                  {items.map((e) => {
                    const meta = KIND_META[e.kind] ?? KIND_META.notice;
                    const Icon = meta.icon;
                    const isOpen = expanded.has(e.seq);
                    return (
                      <li key={e.seq} className="text-xs">
                        <button
                          type="button"
                          onClick={() => e.detail && toggleDetail(e.seq)}
                          disabled={!e.detail}
                          className={`flex w-full items-start gap-2 rounded-card px-2 py-1.5 text-left transition-colors ${
                            e.detail
                              ? "hover:bg-bubble"
                              : "cursor-default"
                          }`}
                        >
                          <Icon
                            size={12}
                            className={`mt-0.5 shrink-0 ${e.ok ? meta.cls : "text-danger"}`}
                          />
                          <span className="min-w-0 flex-1">
                            <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                              <span className="font-medium">{e.title}</span>
                              <span className="text-[10px] text-subtle">
                                {KIND_LABEL[e.kind] ?? e.kind}
                              </span>
                              {e.duration_ms !== null && (
                                <span className="text-[10px] text-subtle">
                                  {fmtDuration(e.duration_ms)}
                                </span>
                              )}
                              <span className="text-[10px] text-subtle">
                                {fmtTime(e.ts_ms)}
                              </span>
                            </span>
                            {isOpen && e.detail && (
                              <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-card bg-bubble px-2 py-1.5 font-mono text-[11px] leading-relaxed text-subtle">
                                {e.detail}
                              </pre>
                            )}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
