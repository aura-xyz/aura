import { useSyncExternalStore } from "react";
import {
  noticesSnapshot,
  subscribeNotices,
  type Notice,
} from "../lib/notices";

/** 订阅全局轻提示队列。 */
export function useNotices(): Notice[] {
  return useSyncExternalStore(subscribeNotices, noticesSnapshot, noticesSnapshot);
}
