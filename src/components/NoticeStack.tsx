import { CircleCheck, TriangleAlert, X } from "lucide-react";
import { useNotices } from "../hooks/useNotices";
import { dismissNotice } from "../lib/notices";

/**
 * 全局轻提示容器（v0.8.0）。
 *
 * 固定右下角、纵向堆叠，新提示排在最下面；不拦截鼠标
 * （容器 pointer-events-none，单条自己开 pointer-events-auto），
 * 免得挡住底下的发送按钮。
 */
export default function NoticeStack() {
  const notices = useNotices();
  if (notices.length === 0) return null;

  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2"
    >
      {notices.map((notice) => {
        const failed = notice.kind === "error";
        const Icon = failed ? TriangleAlert : CircleCheck;
        return (
          <div
            key={notice.id}
            role={failed ? "alert" : "status"}
            className={`aura-notice pointer-events-auto flex items-start gap-2 rounded-card border bg-surface px-3 py-2 text-xs shadow-lg ${
              failed ? "border-danger/40" : "border-line"
            }`}
          >
            <Icon
              size={13}
              aria-hidden
              className={`mt-0.5 shrink-0 ${failed ? "text-danger" : "text-success"}`}
            />
            <span className="min-w-0 flex-1 break-words text-foreground">
              {notice.text}
            </span>
            <button
              type="button"
              aria-label="关闭提示"
              onClick={() => dismissNotice(notice.id)}
              className="shrink-0 rounded-md p-0.5 text-subtle transition-colors hover:text-foreground"
            >
              <X size={12} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
