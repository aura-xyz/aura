/**
 * 助手思考过程折叠行（v0.8.0，参照 dsh ReasoningRow）。
 *
 * 默认折叠，仅显示第一段首行作为摘要，点击展开后渲染完整 Markdown。
 * 流式时摘要右侧用遮罩暗示正在生成，独立于动作卡片呈现，
 * 不干扰正文打字机的 block 顺序。
 */
import { memo, useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import Markdown from "./Markdown";

interface Props {
  text: string;
  /** 是否为当前正在流式输出的 tail */
  running: boolean;
}

export const ReasoningRow = memo(function ReasoningRow({ text, running }: Props) {
  const [expanded, setExpanded] = useState(false);

  const firstLine = useMemo(() => {
    const nl = text.indexOf("\n");
    return nl === -1 ? text : text.slice(0, nl);
  }, [text]);

  const summary = useMemo(() => firstLine.replace(/\*\*/g, ""), [firstLine]);

  return (
    <div
      className="flex flex-col w-full"
      data-state={running ? "running" : "ok"}
      data-expanded={expanded || undefined}
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        aria-label={expanded ? "折叠思考过程" : "展开思考过程"}
        className="flex w-full items-center gap-2 rounded-md border border-line px-3 py-2 text-left text-sm transition-colors hover:bg-bubble hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
      >
        <span className="shrink-0">
          {expanded ? <ChevronDown size={13} className="text-subtle" /> : <ChevronRight size={13} className="text-subtle" />}
        </span>
        <span className="font-medium text-[12px]">思考过程</span>
        <span className="ml-auto text-[11px] text-subtle">
          {running ? "生成中…" : `已就绪`}
        </span>
      </button>

      {expanded && (
        <div className="mt-2 border-t border-line pt-3">
          <Markdown content={text} />
        </div>
      )}

      {!expanded && summary && (
        <div className="mt-2 pl-8">
          <span
            className={`text-xs text-subtle italic ${running ? "animate-pulse" : ""}`}
            style={running ? { maskImage: "linear-gradient(to right, black 80%, transparent)" } : undefined}
          >
            {summary}{running ? "…" : ""}
          </span>
        </div>
      )}
    </div>
  );
});
