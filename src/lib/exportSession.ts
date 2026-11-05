/**
 * `/export` 的前端编排：后端整理可读文本 → 本地打成 zip → 系统保存对话框
 * → 后端落盘。
 *
 * 为什么不走 plugin-fs 的 writeFile：保存对话框给的是用户任选的绝对路径，
 * 不在应用白名单里；用一条后端命令写字节更简单也更可控。
 */
import { save } from "@tauri-apps/plugin-dialog";
import { exportSessionBundle, writeExportBundle } from "./api";
import { exportFileName, zipBundle } from "./exportBundle";

/** 返回 false 表示用户取消了保存对话框，不是错误。 */
export async function downloadSessionZip(
  sessionId: string,
  title?: string,
): Promise<boolean> {
  const path = await save({
    defaultPath: exportFileName(sessionId),
    filters: [{ name: "ZIP 压缩日志", extensions: ["zip"] }],
  });
  if (!path) return false;
  const bundle = await exportSessionBundle(sessionId, title);
  const zip = zipBundle(bundle);
  await writeExportBundle(path, Array.from(zip));
  return true;
}
