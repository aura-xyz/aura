import { useState } from "react";
import { ChevronRight, CircleAlert, Info, LoaderCircle } from "lucide-react";
import DiffView from "./DiffView";

export function ActionRow({
  text,
  ok,
  detail,
  durationMs,
  running,
  diff,
}: {
  text: string;
  ok?: boolean;
  detail?: string;
  /** 本次调用耗时（毫秒）。后端在工具执行完才 emit，运行中没有值 */
  durationMs?: number;
  /** 工具正在执行。成功后端会补发带 ok 与耗时的事件，此处仅覆盖等待期 */
  running?: boolean;
  /** 文件修改的前后内容（v0.7.0），用于差异视图 */
  diff?: { path: string; before: string; after: string };
}) {
  // 失败默认展开，便于直接看到原因；成功默认折叠避免刷屏
  const [open, setOpen] = useState(ok === false);
  const failed = ok === false;
  const hasDetail = Boolean(detail && detail.trim());
  const inFlight = running === true && ok === undefined;

  return (
    <div className="font-mono text-[13px] leading-relaxed">
      <div className="flex items-start gap-2">
        {hasDetail ? (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-label={open ? "收起输出" : "展开输出"}
            className="mt-1 shrink-0 text-subtle transition-transform hover:text-foreground"
          >
            <ChevronRight
              size={13}
              className={`transition-transform ${open ? "rotate-90" : ""}`}
            />
          </button>
        ) : failed ? (
          <CircleAlert size={13} className="mt-1 shrink-0 text-danger" />
        ) : inFlight ? (
          // 进行中锚点：品牌色 spinner，与呼吸光标呼应。
          // 有了它，「Agent 正在干活」不再只能靠光标位置猜。
          <LoaderCircle
            size={13}
            className="mt-1 shrink-0 animate-spin text-brand"
          />
        ) : (
          // 成功态：绿点。此前成功与进行中都是灰箭头，工具跑没跑完看不出来
          <span
            aria-hidden="true"
            className="mt-[5px] size-[7px] shrink-0 rounded-full bg-success"
          />
        )}
        <span
          className={`min-w-0 break-all ${failed ? "text-danger" : "text-subtle"}`}
        >
          {text}
        </span>
        {durationMs !== undefined && (
          // 耗时：灰色小字，右对齐不抢正文。formatMs 从 lib/ 来以便单测
          <span className="ml-auto shrink-0 pl-2 text-[12px] text-subtle">
            {formatMs(durationMs)}
          </span>
        )}
      </div>
      {hasDetail && open && (
        <pre className="scrollbar-hidden ml-5 mt-1.5 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-tag border border-line bg-surface-sunken px-2.5 py-2 text-[12px] leading-relaxed text-subtle">
          {detail}
        </pre>
      )}
      {diff && (
        <div className="ml-5">
          <DiffView path={diff.path} before={diff.before} after={diff.after} />
        </div>
      )}
    </div>
  );
}

/** 毫秒 → 人话。内部用，抽成模块级是为了让单测能直接覆盖 */
export function formatMs(ms: number): string {
  // 时钟回拨等极端情况下 elapsed 可能给出负值，显示成 "-5ms" 是错的
  if (ms <= 0) return "0ms";
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  return `${s < 10 ? s.toFixed(1) : Math.round(s)}s`;
}

export function NoticeRow({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-2 font-mono text-[13px] leading-relaxed text-subtle">
      <Info size={13} className="mt-1 shrink-0" />
      <span className="min-w-0 break-all">{text}</span>
    </div>
  );
}

export function ErrorRow({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-2 font-mono text-[13px] leading-relaxed text-danger">
      <CircleAlert size={13} className="mt-1 shrink-0" />
      <span className="min-w-0 break-all">{text}</span>
    </div>
  );
}