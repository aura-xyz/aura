import { useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import { searchSessions, type SearchableSession } from "../lib/search";

/**
 * 会话搜索面板（v0.7.0，Ctrl+F 呼出）。
 *
 * 覆盖网页做不到的能力：全局快捷键呼出应用内搜索。
 * 结果按「标题命中优先」排序——用户搜会话名通常是想找那个会话。
 */
export default function SessionSearch({
  sessions,
  onClose,
  onOpenSession,
}: {
  sessions: SearchableSession[];
  onClose: () => void;
  /** 点击结果：跳到该会话并定位到那条消息 */
  onOpenSession: (sessionId: string, messageIndex: number) => void;
}) {
  const [query, setQuery] = useState("");
  const hits = useMemo(() => searchSessions(sessions, query), [sessions, query]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 p-6 pt-24"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="搜索会话"
        className="w-full max-w-xl overflow-hidden rounded-card border border-line bg-surface shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-line px-3 py-2">
          <Search size={14} className="shrink-0 text-subtle" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") onClose();
            }}
            placeholder="搜索会话标题与消息内容…"
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-subtle"
          />
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭搜索"
            className="shrink-0 rounded-md p-1 text-subtle transition-colors hover:bg-bubble hover:text-foreground"
          >
            <X size={14} />
          </button>
        </div>

        <div className="max-h-80 overflow-y-auto">
          {query.trim() === "" && (
            <p className="px-3 py-6 text-center text-xs text-subtle">
              输入关键词搜索会话标题与消息内容
            </p>
          )}
          {query.trim() !== "" && hits.length === 0 && (
            <p className="px-3 py-6 text-center text-xs text-subtle">
              没有匹配的结果
            </p>
          )}
          {hits.map((h, i) => (
            <button
              key={`${h.sessionId}-${h.messageIndex}-${i}`}
              type="button"
              onClick={() => onOpenSession(h.sessionId, h.messageIndex)}
              className="block w-full border-b border-line px-3 py-2 text-left transition-colors last:border-b-0 hover:bg-bubble"
            >
              <span className="block text-sm font-medium">{h.sessionTitle}</span>
              <span className="mt-0.5 block truncate text-xs text-subtle">
                {h.snippet}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
