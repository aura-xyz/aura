/**
 * 锚定菜单（v0.8.0）。
 *
 * 贴边的下拉必须 portal + 视口钳制：挂在触发元素下面会被祖先的
 * `overflow:hidden` 裁掉，横向也会溢出窗口。定位交给
 * [`useAnchoredPanel`]，本组件只管开关与「外部点击」的判定——
 * 面板在 portal 里，不在触发元素的子树内，两处都要排除。
 */
import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useAnchoredPanel } from "../hooks/useAnchoredPanel";

export default function AnchoredMenu({
  open,
  anchorRef,
  onClose,
  children,
  className = "min-w-[180px]",
}: {
  open: boolean;
  anchorRef: React.RefObject<HTMLElement | null>;
  onClose: () => void;
  children: ReactNode;
  className?: string;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const style = useAnchoredPanel(anchorRef, panelRef, open, "bottom");

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      const target = e.target as Node;
      if (panelRef.current?.contains(target)) return;
      if (anchorRef.current?.contains(target)) return;
      onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose, anchorRef]);

  if (!open) return null;
  return createPortal(
    <div
      ref={panelRef}
      role="menu"
      style={style}
      className={`rounded-card border border-line bg-surface py-1 shadow-lg ${className}`}
    >
      {children}
    </div>,
    document.body,
  );
}
