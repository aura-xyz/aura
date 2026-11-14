import type { ReactNode } from "react";
import type { CommandItem } from "../lib/commandItems";
import MenuPopup, {
  COMMAND_LISTBOX_ID,
  listboxOptionId,
} from "./MenuPopup";

/**
 * 统一的鼠标可点命令面板。键盘上下/回车由输入框统一处理，
 * 这里只负责展示与鼠标交互，避免两处各管一半。
 */
export default function CommandMenu({
  title,
  items,
  activeIndex,
  onHover,
  onPick,
  header,
  hint,
  emptyText,
}: {
  title: string;
  items: CommandItem[];
  activeIndex: number;
  onHover: (index: number) => void;
  onPick: (item: CommandItem) => void;
  header?: ReactNode;
  hint?: string;
  /** 空面板的说明：模型/技能这类数据源为空时不能只说「没有匹配的命令」 */
  emptyText?: string;
}) {
  return (
    <MenuPopup
      id={COMMAND_LISTBOX_ID}
      activeDescendant={listboxOptionId(COMMAND_LISTBOX_ID, activeIndex)}
      label={title}
      header={
        <>
          <div className="px-3 py-1 text-[11px] text-subtle">{title}</div>
          {header}
        </>
      }
    >
      {items.map((item, i) => (
        <button
          key={item.id}
          id={listboxOptionId(COMMAND_LISTBOX_ID, i)}
          type="button"
          role="option"
          aria-selected={i === activeIndex}
          onMouseEnter={() => onHover(i)}
          onClick={() => onPick(item)}
          className={`flex w-full items-baseline gap-2 px-3 py-1.5 text-left transition-colors ${
            i === activeIndex ? "bg-bubble" : "hover:bg-bubble"
          }`}
        >
          {item.icon && <item.icon size={13} className="shrink-0 self-center text-subtle" />}
          <span className="shrink-0 text-sm">{item.label}</span>
          {item.detail && (
            <span className="min-w-0 flex-1 truncate text-[11px] text-subtle">
              {item.detail}
            </span>
          )}
        </button>
      ))}
      {items.length === 0 && !header && (
        <p className="px-3 py-2 text-[11px] text-subtle">
          {emptyText ?? "没有匹配的命令"}
        </p>
      )}
      {hint && <div className="border-t border-line px-3 py-1 text-[10px] text-subtle">{hint}</div>}
    </MenuPopup>
  );
}
