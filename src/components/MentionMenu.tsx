import { FileCode2, Sparkles } from "lucide-react";
import type { MentionItem } from "../lib/mentions";

/**
 * `@` / `/` 的候选浮层，出现在**输入框上方**。
 *
 * 只负责展示与鼠标交互；键盘（上下键 + 回车 + Esc）由输入框自己处理——
 * 浮层是输入框的一部分，两边各管一半会打架。
 */
export default function MentionMenu({
  kind,
  items,
  activeIndex,
  onPick,
  onHover,
}: {
  kind: "file" | "skill";
  items: MentionItem[];
  /** 当前高亮的下标 */
  activeIndex: number;
  /** 点选（鼠标） */
  onPick: (item: MentionItem) => void;
  /** 鼠标划过（同步高亮） */
  onHover: (index: number) => void;
}) {
  if (items.length === 0) return null;

  return (
    <div
      role="listbox"
      aria-label={kind === "file" ? "文件引用" : "技能调用"}
      className="mb-2 max-h-64 overflow-y-auto rounded-card border border-line bg-surface py-1 shadow-lg"
    >
      <div className="flex items-center gap-1.5 px-3 py-1 text-[11px] text-subtle">
        {kind === "file" ? (
          <FileCode2 size={12} className="shrink-0" />
        ) : (
          <Sparkles size={12} className="shrink-0" />
        )}
        <span>
          {kind === "file"
            ? "引用文件（回车插入路径）"
            : "调用技能（回车插入技能名）"}
        </span>
      </div>
      {items.map((item, i) => (
        <button
          key={`${item.kind}:${item.insert}`}
          type="button"
          role="option"
          aria-selected={i === activeIndex}
          onMouseEnter={() => onHover(i)}
          onClick={() => onPick(item)}
          className={`flex w-full items-baseline gap-2 px-3 py-1.5 text-left transition-colors ${
            i === activeIndex ? "bg-bubble" : "hover:bg-bubble"
          }`}
        >
          <span className="shrink-0 text-sm">{item.label}</span>
          {item.detail && (
            <span className="min-w-0 flex-1 truncate text-[11px] text-subtle">
              {item.detail}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
