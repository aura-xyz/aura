/**
 * 全局轻提示（v0.8.0）。
 *
 * 原先三处各写一条自己的横条——输入区的导出结果、技能页的操作结果、
 * 时间线的复制结果，位置、颜色、消失时机都不一样。这里收敛成一份队列：
 * 右下角固定容器消费，成功/错误两色、3 秒自动消失、可堆叠。
 *
 * 为什么是模块级订阅而不是塞进 `store.tsx`：`InputArea` 是纯 props 组件，
 * 单测直接渲染；挂到 StoreContext 上会逼着每个单测包一层 Provider。
 * 轻提示也不需要跟着会话状态一起走。
 */
export type NoticeKind = "ok" | "error";

export interface Notice {
  id: number;
  kind: NoticeKind;
  text: string;
}

/** 停留时长：够读完一句话，又不至于长期挡住右下角。 */
export const NOTICE_TTL_MS = 3000;

let current: Notice[] = [];
let seq = 0;
const listeners = new Set<() => void>();
const timers = new Map<number, ReturnType<typeof setTimeout>>();

function emit() {
  for (const listener of listeners) listener();
}

/** 推一条提示，返回 id（调用方可据此提前关闭）。 */
export function notify(kind: NoticeKind, text: string): number {
  const id = ++seq;
  current = [...current, { id, kind, text }];
  emit();
  timers.set(
    id,
    setTimeout(() => dismissNotice(id), NOTICE_TTL_MS),
  );
  return id;
}

/** 关掉一条（手动点关闭或到期）。重复关闭是安全的。 */
export function dismissNotice(id: number): void {
  const timer = timers.get(id);
  if (timer !== undefined) {
    clearTimeout(timer);
    timers.delete(id);
  }
  const next = current.filter((n) => n.id !== id);
  if (next.length === current.length) return;
  current = next;
  emit();
}

export function subscribeNotices(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * 当前队列的快照。
 *
 * 只在内容变化时更换数组引用——`useSyncExternalStore` 靠这个判断是否需要重渲染，
 * 每次返回新数组会直接死循环。
 */
export function noticesSnapshot(): Notice[] {
  return current;
}

/** 仅供测试：清空队列与计时器。 */
export function resetNotices(): void {
  for (const timer of timers.values()) clearTimeout(timer);
  timers.clear();
  current = [];
  emit();
}
