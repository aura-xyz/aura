/**
 * 全局命令面板（v0.8.0，Ctrl+K）。
 *
 * 把「动作 / 会话 / 技能 / 文件」四类入口收进一个面板：此前它们散在
 * 左栏导航、Ctrl+F 搜索、`/` 命令、`@` 引用四处，用户得先记住「想找的东西
 * 属于哪类」。查询为空时按分组列出，并按位置标 1–9 供直达。
 *
 * 键盘约定与输入框里的 `/` 面板一致：上下选、回车执行、Esc 关闭。
 * 数据由 App 组装传入（会话与文件都要现查），这里只管渲染与选择状态。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";
import {
  filterCommandItems,
  groupCommandItems,
  GROUP_LABEL,
  type CommandItem,
} from "../lib/commandItems";
import { loadFrecency, rankByFrecency, topRecentIds } from "../lib/frecency";
import { useOverlay } from "../hooks/useOverlay";

/** 数字键直达的条数上限。 */
const DIGIT_LIMIT = 9;

export default function CommandPalette({
  items,
  onQueryChange,
  onPick,
  onClose,
  loading,
}: {
  items: CommandItem[];
  /** 查询变化时由 App 去查文件（会话与技能在 App 侧已备好） */
  onQueryChange?: (query: string) => void;
  onPick: (item: CommandItem) => void;
  onClose: () => void;
  /** 远端查询进行中（文件/会话） */
  loading?: boolean;
}) {
  // 组件只在打开时挂载，故 open 恒为 true；Esc 由全局浮层栈统一关最上层
  useOverlay("command-palette", true, onClose);
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(
    () => filterCommandItems(items, query),
    [items, query],
  );
  // 最近使用只在空查询时生效：一旦开始搜索，位置应当由匹配度决定。
  // 排序限定在组内，避免把会话项排进动作组里。
  const [frecency] = useState(() => loadFrecency());
  const recentIds = useMemo(
    () => (query ? new Set<string>() : topRecentIds(frecency, Date.now())),
    [frecency, query],
  );
  const groups = useMemo(() => {
    const grouped = groupCommandItems(filtered);
    if (query) return grouped;
    const now = Date.now();
    return grouped.map((g) => ({
      ...g,
      items: rankByFrecency(g.items, frecency, now),
    }));
  }, [filtered, frecency, query]);

  // 结果集变化（打字、异步文件回来）后把高亮拉回第一条，
  // 否则回车会选中一个用户没看过的位置。
  useEffect(() => {
    setIndex(0);
  }, [query]);

  useEffect(() => {
    if (index > filtered.length - 1) setIndex(0);
  }, [filtered.length, index]);

  function changeQuery(value: string) {
    setQuery(value);
    onQueryChange?.(value);
  }

  function pickActive() {
    const item = filtered[index] ?? filtered[0];
    if (item) onPick(item);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setIndex((i) => (filtered.length === 0 ? 0 : (i + 1) % filtered.length));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setIndex((i) =>
        filtered.length === 0 ? 0 : (i - 1 + filtered.length) % filtered.length,
      );
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      pickActive();
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
      return;
    }
    // 数字键直达：只在查询为空时生效，否则会和正常输入抢字符。
    if (!query && /^[1-9]$/.test(e.key)) {
      const i = Number(e.key) - 1;
      const item = filtered[i];
      if (item) {
        e.preventDefault();
        onPick(item);
      }
    }
  }

  // 让高亮项始终在可视区内
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(
      '[data-active="true"]',
    );
    // jsdom 没有 scrollIntoView，可选调用避免单测直接炸
    el?.scrollIntoView?.({ block: "nearest" });
  }, [index]);

  // 扁平序号 → 在分组渲染里显示 1–9
  let flat = -1;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 p-6 pt-24"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="命令面板"
        className="flex max-h-[70vh] w-full max-w-xl flex-col overflow-hidden rounded-card border border-line bg-surface shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-line px-3 py-2">
          <Search size={14} className="shrink-0 text-subtle" />
          <input
            autoFocus
            value={query}
            onChange={(e) => changeQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="搜索命令、会话、技能与文件…"
            aria-label="搜索命令、会话、技能与文件"
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-subtle"
          />
          {loading && <span className="shrink-0 text-[11px] text-subtle">查询中…</span>}
        </div>

        <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto py-1">
          {filtered.length === 0 && !loading && (
            <p className="px-3 py-6 text-center text-xs text-subtle">
              没有匹配的结果
            </p>
          )}
          {groups.map((group) => (
            <section key={group.group}>
              <p className="px-3 pb-0.5 pt-1.5 text-[10px] uppercase tracking-[0.08em] text-subtle">
                {GROUP_LABEL[group.group]}
              </p>
              {group.items.map((item) => {
                flat += 1;
                const i = flat;
                const active = i === index;
                const Icon = item.icon;
                return (
                  <button
                    key={item.id}
                    type="button"
                    data-active={active}
                    aria-selected={active}
                    onMouseEnter={() => setIndex(i)}
                    onClick={() => onPick(item)}
                    className={`flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors ${
                      active ? "bg-bubble" : "hover:bg-bubble"
                    }`}
                  >
                    {i < DIGIT_LIMIT && !query ? (
                      <kbd className="w-4 shrink-0 rounded border border-line text-center text-[10px] leading-4 text-subtle">
                        {i + 1}
                      </kbd>
                    ) : (
                      <span className="w-4 shrink-0" />
                    )}
                    {Icon && <Icon size={13} className="shrink-0 text-subtle" />}
                    <span className="shrink-0 text-sm">{item.label}</span>
                    {recentIds.has(item.id) && (
                      <span className="shrink-0 rounded-full border border-brand/40 px-1 text-[9px] leading-4 text-brand">
                        最近
                      </span>
                    )}
                    {item.detail && (
                      <span className="min-w-0 flex-1 truncate text-[11px] text-subtle">
                        {item.detail}
                      </span>
                    )}
                  </button>
                );
              })}
            </section>
          ))}
        </div>

        <div className="flex items-center justify-between border-t border-line px-3 py-1.5 text-[10px] text-subtle">
          <span>↑↓ 选择 · Enter 执行 · Esc 关闭</span>
          <span>1–9 直达</span>
        </div>
      </div>
    </div>
  );
}
