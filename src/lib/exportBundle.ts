import { strToU8, zipSync } from "fflate";
import type { ExportBundle } from "./api";

/** `/export` 的 zip 内文件清单（可读三件套）。抽成纯函数便于单测钉住。 */
export function bundleEntries(bundle: ExportBundle): Record<string, Uint8Array> {
  return {
    "conversation.md": strToU8(bundle.conversation_md),
    "timeline.md": strToU8(bundle.timeline_md),
    "updater.log": strToU8(bundle.updater_log),
  };
}

export function exportFileName(sessionId: string): string {
  const safe = sessionId.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 32);
  return `aura-session-${safe || "current"}.zip`;
}

/** 打包成 zip 字节；落盘交给后端命令，绕开 plugin-fs 的路径权限。 */
export function zipBundle(bundle: ExportBundle): Uint8Array {
  return zipSync(bundleEntries(bundle));
}
