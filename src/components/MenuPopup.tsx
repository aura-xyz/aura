/**
 * 输入辅助浮层的统一外壳（v0.8.0）。
 *
 * 命令面板与 @ 引用浮层此前是两份几乎一样的容器：同一串圆角/边框/阴影，
 * 各写一遍，改一处忘了另一处就对不齐。这里收成一个壳，只留两件事给调用方：
 * 内容与标题行。`groups` 是留给统一命令面板（C27）的分组渲染能力。
 *
 * 宽度规则：必须与输入卡一致（同一条 `CONTENT_WIDTH`）——浮层若整块铺满，
 * 两者的左右边界就对不上，视觉上像两个不同的层。
 */
import type { ReactNode } from "react";
import { CONTENT_WIDTH } from "../lib/layout";

export default function MenuPopup({
  label,
  header,
  maxHeight = "max-h-72",
  children,
}: {
  /** 无障碍名（listbox 用） */
  label: string;
  /** 标题行：图标 + 说明 */
  header?: ReactNode;
  maxHeight?: string;
  children: ReactNode;
}) {
  return (
    <div
      role="listbox"
      aria-label={label}
      className={`aura-pop-in mx-auto mb-2 ${CONTENT_WIDTH} ${maxHeight} overflow-y-auto rounded-card border border-line bg-surface py-1 shadow-lg`}
    >
      {header}
      {children}
    </div>
  );
}
