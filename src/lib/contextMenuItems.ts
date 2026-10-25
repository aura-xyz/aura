/**
 * 右键菜单条目推导（按目标类型分派）。
 *
 * v0.6.3 之前，全局右键的实际行为是：除会话项与工作区行外一律
 * `preventDefault()` 却**不弹任何菜单** —— 原生菜单被禁、自绘菜单也没有，
 * 正文右键什么都不发生。App.tsx 里那段的注释还写着「其余区域统一用原生
 * 菜单」，与代码相反。
 *
 * 本模块把「什么目标该给什么条目」抽成纯函数，动机与 workspaceMenu 一致：
 * 这段逻辑曾是内联在 App 的 onContextMenu 里、既无法测试也藏了上面的缺陷。
 */

export type MenuItem = {
  label: string;
  danger?: boolean;
  onClick: () => void;
};

/** 消息气泡右键可提供的条目。 */
export function messageMenuItems(handlers: {
  onCopy: () => void;
  onQuote?: () => void;
}): MenuItem[] {
  const items: MenuItem[] = [{ label: "复制全文", onClick: handlers.onCopy }];
  if (handlers.onQuote) {
    items.push({ label: "引用", onClick: handlers.onQuote });
  }
  return items;
}

/** 代码块右键可提供的条目。 */
export function codeBlockMenuItems(handlers: { onCopy: () => void }): MenuItem[] {
  return [{ label: "复制代码", onClick: handlers.onCopy }];
}

/** 普通正文右键可提供的条目。 */
export function textMenuItems(handlers: { onCopy: () => void }): MenuItem[] {
  return [{ label: "复制", onClick: handlers.onCopy }];
}

/**
 * 判断右键目标是否落在消息气泡内。
 *
 * 用 data 属性而不是 class 判定：class 会随样式重构变，
 * data-msg 是语义锚点，与 data-ctx-session / data-ctx-workspace 同一套约定。
 */
export function findMessageTarget(el: Element | null): HTMLElement | null {
  return (el?.closest("[data-ctx-message]") as HTMLElement | null) ?? null;
}

/** 右键目标是否落在代码块内。 */
export function findCodeBlockTarget(el: Element | null): HTMLElement | null {
  return (el?.closest("[data-ctx-codeblock]") as HTMLElement | null) ?? null;
}
