import { X } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect } from "react";

interface ConfirmDialogProps {
  /** 标题 */
  title: string;
  /** 详细内容（可包含任意 JSX） */
  children: ReactNode;
  /** 确认按钮文案，danger=true 时显示为红色 */
  confirmText: string;
  /** 确认按钮是否危险色（红色） */
  danger?: boolean;
  /** 取消按钮文案 */
  cancelText?: string;
  /** 是否正在处理中（禁用按钮、显示加载态） */
  busy?: boolean;
  /** 点击遮罩关闭 */
  onCancel: () => void;
  /** 点击确认 */
  onConfirm: () => void;
}

export default function ConfirmDialog({
  title,
  children,
  confirmText,
  danger = false,
  cancelText = "取消",
  busy = false,
  onCancel,
  onConfirm,
}: ConfirmDialogProps) {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) {
        onCancel();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, onCancel]);

  return (
    <div
      data-testid="overlay"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-6"
      onClick={() => {
        if (!busy) onCancel();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="flex max-h-full w-full max-w-xl flex-col rounded-card border border-line bg-surface shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold">{title}</h3>
          </div>
          <button
            type="button"
            aria-label="关闭"
            disabled={busy}
            onClick={onCancel}
            className="shrink-0 rounded-md p-1 text-subtle transition-colors hover:text-foreground disabled:opacity-40"
          >
            <X size={15} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {children}
          {busy && <p className="mt-3 text-xs text-subtle">处理中…</p>}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-line px-5 py-3">
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="rounded-full border border-line px-4 py-1.5 text-sm text-subtle transition-colors hover:text-foreground disabled:opacity-40"
          >
            {cancelText}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onConfirm}
            className={`rounded-full px-4 py-1.5 text-sm text-white transition-colors hover:opacity-90 disabled:opacity-40 dark:text-surface ${
              danger ? "bg-danger" : "bg-brand"
            }`}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}