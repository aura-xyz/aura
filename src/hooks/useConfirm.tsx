/**
 * 全局确认语义（v0.8.0）。
 *
 * 破坏性操作不必各写一套（行内二次点击 / 手搓模态）：调用方
 * `const { confirm, dialog } = useConfirm()`，`await confirm({...})` 拿布尔值，
 * 再把 `dialog` 渲染到任意位置即可。弹窗本身复用 ConfirmDialog，
 * 键位（Esc 取消）与危险色都与既有弹窗一致。
 */
import { useCallback, useState, type ReactNode } from "react";
import ConfirmDialog from "../components/ConfirmDialog";

export interface ConfirmOptions {
  title: string;
  /** 正文，可含任意 JSX（例如把对象名字体加粗） */
  message: ReactNode;
  confirmText?: string;
  danger?: boolean;
}

interface PendingConfirm extends ConfirmOptions {
  resolve: (ok: boolean) => void;
}

export function useConfirm() {
  const [pending, setPending] = useState<PendingConfirm | null>(null);

  const confirm = useCallback(
    (options: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        setPending((prev) => {
          // 上一次还没答复就被新问题顶掉：让旧 Promise 以「取消」收尾，
          // 否则调用方 await 会永远挂着。
          prev?.resolve(false);
          return { ...options, resolve };
        });
      }),
    [],
  );

  function settle(ok: boolean) {
    if (!pending) return;
    pending.resolve(ok);
    setPending(null);
  }

  const dialog = pending ? (
    <ConfirmDialog
      title={pending.title}
      confirmText={pending.confirmText ?? "确定"}
      danger={pending.danger}
      onCancel={() => settle(false)}
      onConfirm={() => settle(true)}
    >
      {pending.message}
    </ConfirmDialog>
  ) : null;

  return { confirm, dialog };
}
