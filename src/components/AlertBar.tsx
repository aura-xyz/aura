/**
 * 横幅三件套统一（v0.8.0）。
 *
 * 输入区此前有三种横幅：长期目标条、编辑提示条、操作提示横条。高度、
 * 圆角、左侧色条各写一套，视觉权重也就各说各话。这里收成一个组件：
 * 统一 rounded-tag + 1.5 行高 + 左侧 2px 状态色竖线（用 `border-l-2`
 * 实现，不额外占一个 span，也就不必用负边距去对补偿）。
 *
 * 宽度不带 `CONTENT_WIDTH`：横幅由调用方决定放在哪条限宽链里
 * （输入区是对话列，未来别处可能是面板内），组件只负责长相。
 */
import type { ReactNode } from "react";

export type AlertVariant = "info" | "edit" | "success" | "danger";

const VARIANT: Record<
  AlertVariant,
  { frame: string; accent: string; icon: string }
> = {
  info: { frame: "border-line bg-surface", accent: "border-l-brand", icon: "text-brand" },
  edit: { frame: "border-brand/40 bg-bubble-user", accent: "border-l-brand", icon: "text-brand" },
  success: { frame: "border-line bg-surface", accent: "border-l-success", icon: "text-success" },
  danger: { frame: "border-danger/40 bg-surface", accent: "border-l-danger", icon: "text-danger" },
};

export default function AlertBar({
  variant = "info",
  icon,
  action,
  className = "",
  children,
}: {
  variant?: AlertVariant;
  /** 左侧图标；不传则不占位 */
  icon?: ReactNode;
  /** 右侧动作区（按钮） */
  action?: ReactNode;
  /** 追加类，例如限宽链 */
  className?: string;
  children: ReactNode;
}) {
  const v = VARIANT[variant];
  return (
    <div
      className={`flex items-center gap-2 rounded-tag border border-l-2 px-3 py-1.5 text-xs ${v.frame} ${v.accent} ${className}`}
    >
      {icon && (
        <span className={`shrink-0 ${v.icon}`} aria-hidden>
          {icon}
        </span>
      )}
      <div className="min-w-0 flex-1">{children}</div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
