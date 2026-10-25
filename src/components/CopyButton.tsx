import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { copyText } from "../lib/clipboard";

/**
 * 复制按钮。带「已复制」短反馈。
 *
 * 抽成共用组件是因为气泡复制、代码块复制、差异视图复制三处都要用，
 * 且都需要同一套反馈语义——没有反馈的复制按钮等于没有按钮：
 * 用户点了不知道成没成功，会再点一次。
 */
export default function CopyButton({
  text,
  className = "",
  label = "复制",
}: {
  /** 要复制的文本。空串时按钮禁用——复制空内容是没有意义的操作 */
  text: string;
  className?: string;
  label?: string;
}) {
  const [done, setDone] = useState(false);
  const [failed, setFailed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 卸载时清掉未触发的定时器，避免在已卸载组件上 setState
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  async function onClick() {
    const ok = await copyText(text);
    if (!ok) {
      setFailed(true);
      timer.current = setTimeout(() => setFailed(false), 2000);
      return;
    }
    setDone(true);
    timer.current = setTimeout(() => setDone(false), 1500);
  }

  const state = done ? "done" : failed ? "failed" : "idle";
  const Icon = done ? Check : Copy;
  const text0 = done ? "已复制" : failed ? "复制失败" : label;

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!text}
      aria-label={text0}
      data-state={state}
      className={`inline-flex items-center gap-1 rounded-md border border-line px-2 py-1 text-[11px] text-subtle transition-colors hover:border-brand hover:text-brand disabled:pointer-events-none disabled:opacity-40 ${
        done ? "text-success" : ""
      } ${className}`}
    >
      <Icon size={12} className="shrink-0" />
      <span>{text0}</span>
    </button>
  );
}
