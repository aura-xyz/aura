import { useSyncExternalStore } from "react";
import {
  DEFAULT_BINDINGS,
  loadShortcuts,
  subscribeShortcuts,
} from "../lib/shortcuts";

/**
 * 订阅当前键位表。
 *
 * `loadShortcuts` 返回模块级缓存，引用稳定；保存/重置会通知所有订阅者，
 * 因此改完键位不用刷新、也不用重新打开设置页就能生效。
 */
export function useShortcuts() {
  return useSyncExternalStore(
    subscribeShortcuts,
    loadShortcuts,
    () => DEFAULT_BINDINGS,
  );
}
