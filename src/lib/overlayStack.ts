/**
 * 全局浮层栈（v0.8.1 P09）。
 *
 * 此前 Esc 由每个浮层各自监听：两层叠在一起时，一次 Esc 可能把两层都关掉，
 * 或者关掉的不是最上面那层。这里维护一个**全局唯一的栈**，App 只注册一次
 * Esc 监听并调用 closeTopOverlay()，各浮层只负责注册 / 注销自己。
 *
 * 栈是模块级单例而非 React Context：浮层可能挂在 portal 里、也可能是命令式
 * 打开的弹窗，用 Context 会把注册链绑死在渲染树上。
 */

export interface OverlayEntry {
  id: string;
  close: () => void;
}

const stack: OverlayEntry[] = [];
const listeners = new Set<() => void>();

function emit() {
  for (const fn of listeners) fn();
}

/** 注册一层浮层，返回注销器。同 id 重复注册会先移除旧项（视为重新置顶）。 */
export function pushOverlay(id: string, close: () => void): () => void {
  const existing = stack.findIndex((e) => e.id === id);
  if (existing >= 0) stack.splice(existing, 1);
  stack.push({ id, close });
  emit();
  return () => {
    const i = stack.findIndex((e) => e.id === id);
    if (i < 0) return;
    stack.splice(i, 1);
    emit();
  };
}

/**
 * 关掉最上面一层。返回 false 表示栈为空、调用方不应拦截这次按键。
 *
 * 先出栈再调用 close：close 内部常会同步 setState 触发组件卸载，卸载又
 * 会执行注销器；若顺序反过来，注销器可能误删刚压入的新浮层。
 */
export function closeTopOverlay(): boolean {
  const top = stack.pop();
  if (!top) return false;
  emit();
  top.close();
  return true;
}

export function hasOverlays(): boolean {
  return stack.length > 0;
}

export function peekOverlayId(): string | undefined {
  return stack[stack.length - 1]?.id;
}

/** 只读快照，供调试与单测断言顺序。 */
export function overlayStackSnapshot(): readonly string[] {
  return stack.map((e) => e.id);
}

export function subscribeOverlayStack(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** 仅供单测：清空栈。 */
export function clearOverlays(): void {
  stack.length = 0;
  emit();
}
