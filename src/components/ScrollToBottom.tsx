import { useEffect, useState } from "react";
import { ArrowDown } from "lucide-react";

/**
 * 回到底部悬浮按钮。
 *
 * 长对话里模型正在输出时用户往上翻看历史，滚到底部后**不会自动跟随**了
 * （跟随会让用户被拽回去）。这个按钮是唯一的回去路径——没有它，
 * 用户只能手动滑很久，或者根本不知道已经偏离了最新内容。
 *
 * 阈值与 App.tsx 里自动跟随的判定共用同一个常量，两处不一致会出现
 * 「按钮还在但已经自动跟着滚了」这类割裂。
 */
export const NEAR_BOTTOM_PX = 140;

export default function ScrollToBottom({
  scrollRef,
  messagesLength,
}: {
  scrollRef: React.RefObject<HTMLDivElement | null>;
  /** 消息数变化时要重算可见性（新消息会把容器推长） */
  messagesLength: number;
}) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    function onScroll() {
      const nearBottom =
        el!.scrollHeight - el!.scrollTop - el!.clientHeight < NEAR_BOTTOM_PX;
      setShow(!nearBottom);
    }
    onScroll();
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [scrollRef, messagesLength]);

  function jump() {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }

  if (!show) return null;

  return (
    <button
      type="button"
      onClick={jump}
      aria-label="回到底部"
      className="absolute bottom-4 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1 rounded-full border border-line bg-surface px-3 py-1.5 text-xs text-subtle shadow-md transition-colors hover:border-brand hover:text-brand"
    >
      <ArrowDown size={12} className="shrink-0" />
      <span>回到底部</span>
    </button>
  );
}
