import { useEffect, useState } from "react";

/**
 * `/goal` 的输入面板，作为 CommandMenu 的 header 嵌入。
 * `initial` 来自 `/goal <参数>` 或目标条里已有的内容。
 */
export default function GoalPanel({
  initial,
  onSave,
  onClear,
}: {
  initial: string;
  onSave: (text: string) => void;
  onClear: () => void;
}) {
  const [text, setText] = useState(initial);
  useEffect(() => {
    setText(initial);
  }, [initial]);

  return (
    <div className="px-3 pb-2 pt-1">
      <label htmlFor="aura-goal-input" className="block text-[11px] text-subtle">
        给模型设定一个长期目标
      </label>
      <textarea
        id="aura-goal-input"
        data-goal-input
        rows={2}
        value={text}
        onChange={(e) => setText(e.currentTarget.value)}
        placeholder="例如：把这个仓库的 UI 重构完并补齐测试"
        className="mt-1 w-full resize-none rounded-md border border-line bg-surface px-2 py-1.5 text-sm leading-relaxed outline-none placeholder:text-subtle focus:border-brand"
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            onSave(text);
          }
        }}
      />
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="text-[10px] text-subtle">
          每轮对话自动带上目标，不会自动继续运行
        </span>
        <div className="flex shrink-0 gap-1.5">
          <button
            type="button"
            onClick={onClear}
            className="rounded-tag border border-line px-2 py-1 text-[11px] text-subtle transition-colors hover:text-foreground"
          >
            清除
          </button>
          <button
            type="button"
            onClick={() => onSave(text)}
            className="rounded-tag bg-brand px-2 py-1 text-[11px] text-white transition-colors hover:bg-brand-strong"
          >
            保存目标
          </button>
        </div>
      </div>
    </div>
  );
}
