/**
 * 浮层注册 + 焦点恢复（v0.8.1 P09）。
 *
 * 一行调用同时做两件事：把浮层压进全局栈（Esc 由 App 统一关最上层），
 * 以及记住打开前的焦点、关闭后还回去。若原元素已卸载（比如浮层里删掉了
 * 触发它的那条消息），回退到输入框，避免焦点掉到 body 上之后键盘全失效。
 */
import { useEffect, useRef } from "react";
import { focusInput } from "../lib/focusInput";
import { pushOverlay } from "../lib/overlayStack";

export function useOverlay(id: string, open: boolean, onClose: () => void) {
  // 用 ref 持有最新回调：onClose 在父组件里常常是内联箭头函数，
  // 若把它放进 effect 依赖，每次渲染都会重新注册（也就重新置顶）。
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const active = document.activeElement;
    const restore =
      active instanceof HTMLElement && active !== document.body ? active : null;
    const unregister = pushOverlay(id, () => closeRef.current());
    return () => {
      unregister();
      if (restore && restore.isConnected) restore.focus();
      else focusInput();
    };
  }, [id, open]);
}
