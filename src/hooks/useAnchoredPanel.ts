/**
 * 浮层定位：固定在触发元素的上方或下方，并钳制在视口内（v0.8.0）。
 *
 * 两个用得上的地方：右上角的「在…中打开」菜单（按钮贴窗口边缘，下拉
 * 会伸出窗口）与输入框下方的统计详情卡（不能挂在按钮上被裁掉）。
 * DSH 的 useAnchoredPosition / stat-dialog 走的是同一套语义：portal +
 * fixed + 12px 视口留白 + 空间不够时翻面。
 *
 * 只负责定位，开关状态由调用方持有 —— 这样菜单和对话框可以各自决定
 * 什么时候算「外部点击」。
 */
import { useLayoutEffect, useState, type CSSProperties, type RefObject } from "react";

const MARGIN = 12;
const GAP = 8;

/** 尚未测量出来的那一帧：hidden 但仍参与布局，量完立刻定位。 */
export const MEASURE_STYLE: CSSProperties = {
  position: "fixed",
  left: 0,
  top: 0,
  visibility: "hidden",
  zIndex: 1100,
};

export function useAnchoredPanel<A extends HTMLElement, P extends HTMLElement>(
  anchorRef: RefObject<A | null>,
  panelRef: RefObject<P | null>,
  open: boolean,
  side: "top" | "bottom" = "bottom",
): CSSProperties {
  const [pos, setPos] = useState<CSSProperties | null>(null);

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const place = () => {
      const anchor = anchorRef.current;
      const panel = panelRef.current;
      if (!anchor || !panel) return;
      const a = anchor.getBoundingClientRect();
      const rect = panel.getBoundingClientRect();
      const width = panel.offsetWidth || rect.width;
      const height = panel.offsetHeight || rect.height;
      const vw = window.innerWidth;
      const vh = window.innerHeight;

      const below = a.bottom + GAP;
      const above = a.top - GAP - height;
      const fitsBelow = below + height <= vh - MARGIN;
      const fitsAbove = above >= MARGIN;
      let top: number;
      if (side === "bottom") {
        top = fitsBelow ? below : fitsAbove ? above : Math.max(MARGIN, vh - MARGIN - height);
      } else {
        top = fitsAbove ? above : fitsBelow ? below : Math.max(MARGIN, vh - MARGIN - height);
      }

      // 右边缘对齐触发元素，再钳到视口内；窄窗口下也不会横向溢出。
      const left = Math.max(
        MARGIN,
        Math.min(a.right - width, vw - MARGIN - width),
      );
      setPos({
        position: "fixed",
        left,
        top,
        visibility: "visible",
        zIndex: 1100,
      });
    };

    place();
    window.addEventListener("resize", place);
    // capture：任何祖先容器滚动都要跟着重算，浮层不能留在旧位置
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [anchorRef, panelRef, open, side]);

  return pos ?? MEASURE_STYLE;
}
