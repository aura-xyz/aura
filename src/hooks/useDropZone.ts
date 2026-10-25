import { useEffect, useRef } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";

/**
 * 接收拖入的文件路径。
 *
 * 用 Tauri 官方的 `onDragDropEvent` 而不是 DOM 的 drag/drop：
 * DOM 事件拿不到**真实路径**（只有 File 对象，且出于安全没有 path），
 * 而 Tauri 的事件直接给出 `paths: string[]`。
 *
 * 四种事件（**`over` 不带 paths**，只有光标位置）：
 * - `enter` → 刚拖进窗口，带路径：用来显示「松手即可附加」的提示
 * - `over`  → 光标在窗口内移动，忽略
 * - `drop`  → 松手，带路径
 * - `leave` → 拖离窗口或被取消
 */
export function useDropZone(options: {
  /** 刚拖进窗口时回调（用于显示提示） */
  onEnter?: (paths: string[]) => void;
  /** 松手时回调，参数是拖入的路径 */
  onDrop: (paths: string[]) => void;
  /** 拖离窗口或被取消 */
  onCancel?: () => void;
}) {
  const { onEnter, onDrop, onCancel } = options;

  // 回调每次渲染都是新函数。放进 ref，订阅只建一次——
  // 否则依赖数组一变就解绑重绑，拖放事件会在两次之间丢失。
  const handlers = useRef({ onEnter, onDrop, onCancel });
  handlers.current = { onEnter, onDrop, onCancel };

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;

    (async () => {
      try {
        const un = await getCurrentWebview().onDragDropEvent((event) => {
          const p = event.payload;
          const h = handlers.current;
          if (p.type === "enter") {
            h.onEnter?.(p.paths);
          } else if (p.type === "drop") {
            h.onDrop(p.paths);
          } else if (p.type === "leave") {
            h.onCancel?.();
          }
          // "over" 只有光标位置，忽略
        });
        if (disposed) {
          un();
        } else {
          unlisten = un;
        }
      } catch {
        // 非 Tauri 环境（浏览器里开前端测试页）没有这个 API，
        // 静默跳过——拖放是增强功能，不该让它把整个应用搞崩
      }
    })();

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);
}
