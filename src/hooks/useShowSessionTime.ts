import { useSyncExternalStore } from "react";
import {
  loadShowSessionTime,
  subscribeShowSessionTime,
} from "../lib/sessionTime";

/** 「会话列表时间戳」开关的唯一订阅入口；默认开启。 */
export function useShowSessionTime(): boolean {
  return useSyncExternalStore(
    subscribeShowSessionTime,
    loadShowSessionTime,
    () => true,
  );
}
