import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { diffLines, type DiffLine } from "../lib/diff";

/**
 * 文件差异视图。
 *
 * 折叠在工具调用行里按需展开——差异内容可能很长，默认展开会把对话流
 * 撑乱。行级增删高亮，不做字符级（见 lib/diff.ts 的说明）。
 */
export default function DiffView({
  path,
  before,
  after,
}: {
  path: string;
  before: string;
  after: string;
}) {
  const [open, setOpen] = useState(false);
  const result = useMemo(() => diffLines(before, after), [before, after]);

  const summary = result.degraded
    ? `文件较大，仅显示整体替换（+${result.added} / -${result.removed}）`
    : `+${result.added} / -${result.removed}`;

  return (
    <div className="mt-1.5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="inline-flex items-center gap-1 rounded-md border border-line px-2 py-1 text-[11px] text-subtle transition-colors hover:border-brand hover:text-brand"
      >
        {open ? (
          <ChevronDown size={12} className="shrink-0" />
        ) : (
          <ChevronRight size={12} className="shrink-0" />
        )}
        <span className="font-mono">{path}</span>
        <span className="text-[11px]">{summary}</span>
      </button>

      {open && (
        <div className="mt-1.5 overflow-x-auto rounded-tag border border-line bg-surface-sunken font-mono text-[12px] leading-relaxed">
          {result.lines.map((l, idx) => (
            <DiffRow key={idx} line={l} />
          ))}
        </div>
      )}
    </div>
  );
}

function DiffRow({ line }: { line: DiffLine }) {
  const prefix = line.type === "add" ? "+" : line.type === "del" ? "-" : " ";
  const cls =
    line.type === "add"
      ? "bg-success/10 text-foreground"
      : line.type === "del"
        ? "bg-danger/10 text-foreground"
        : "text-subtle";
  return (
    <div className={`flex whitespace-pre ${cls}`}>
      <span className="w-8 shrink-0 select-none text-right pr-2 text-subtle">
        {line.oldLine ?? ""}
      </span>
      <span className="w-8 shrink-0 select-none text-right pr-2 text-subtle">
        {line.newLine ?? ""}
      </span>
      <span className="w-4 shrink-0 select-none">{prefix}</span>
      <span className="pr-3">{line.text}</span>
    </div>
  );
}
