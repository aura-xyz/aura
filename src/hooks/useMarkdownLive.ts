import { useSyncExternalStore } from "react";
import {
  loadMarkdownLive,
  subscribeMarkdownLive,
} from "../lib/markdownLive";

/**
 * 「输入框 Markdown 实时渲染」开关的唯一订阅入口。
 *
 * getSnapshot 返回布尔值（原始类型），多次读取同值不会触发额外渲染；
 * getServerSnapshot 固定为 true，与「默认开启」一致。
 */
export function useMarkdownLive(): boolean {
  return useSyncExternalStore(
    subscribeMarkdownLive,
    loadMarkdownLive,
    () => true,
  );
}
