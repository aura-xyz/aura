import { useCallback, useEffect, useRef, useState } from "react";

/** 与 index.css 里 .rightbar-enter / .rightbar-leave 的动画时长保持一致。 */
export const RIGHTBAR_ANIM_MS = 200;

/**
 * 右栏展开/收起过渡。
 *
 * 条件渲染没法播退出动画：一设为 false 元素立刻卸载。这里收起时先进入
 * `closing`，等动画播完再真正卸载；途中重新打开会取消这次卸载，避免
 * 「点关闭再点开，面板却在动画结束时消失」。
 */
export function useRightbarTransition() {
  const [shown, setShown] = useState(false);
  const [closing, setClosing] = useState(false);
  const timer = useRef<number | null>(null);

  const cancelTimer = useCallback(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  const open = useCallback(() => {
    cancelTimer();
    setClosing(false);
    setShown(true);
  }, [cancelTimer]);

  const close = useCallback(() => {
    cancelTimer();
    setClosing(true);
    timer.current = window.setTimeout(() => {
      timer.current = null;
      setShown(false);
      setClosing(false);
    }, RIGHTBAR_ANIM_MS);
  }, [cancelTimer]);

  useEffect(() => cancelTimer, [cancelTimer]);

  return { shown, closing, open, close };
}
