/**
 * 会话用量面板（v0.8.0，右栏「用量」页签）。
 *
 * 数字全部来自后端 usage 事件，不做估算；唯一带「估算」字样的是成本，
 * 按牌价折算并注明口径。CSV 导出复用 exportSession 的写入通道
 * （save 对话框 → 字节写盘），不另造一套。
 */
import { useState } from "react";
import { Download } from "lucide-react";
import { save } from "@tauri-apps/plugin-dialog";
import { strToU8 } from "fflate";
import { useStore, type Session } from "../store";
import { writeExportBundle } from "../lib/api";
import { notify } from "../lib/notices";
import { usageCsv, usageRows } from "../lib/usageReport";

export function UsagePanel({ model }: { model: string }) {
  let session: Session | undefined;
  try {
    session = useStore().activeSession;
  } catch {
    return null;
  }
  const [busy, setBusy] = useState(false);

  if (!session) {
    return (
      <p className="px-3 py-3 text-[11px] text-subtle">
        当前没有选中的会话。
      </p>
    );
  }

  const rows = usageRows(session, model);

  async function downloadCsv() {
    if (!session || busy) return;
    setBusy(true);
    try {
      const path = await save({
        defaultPath: `aura-usage-${session.id}.csv`,
        filters: [{ name: "CSV", extensions: ["csv"] }],
      });
      if (!path) return;
      await writeExportBundle(path, Array.from(strToU8(usageCsv(session, model))));
      notify("ok", "用量已导出");
    } catch (e) {
      notify("error", `导出失败：${String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium text-subtle">本会话累计</span>
        <button
          type="button"
          onClick={() => void downloadCsv()}
          disabled={busy}
          className="flex items-center gap-1 rounded-tag border border-line px-2 py-0.5 text-[11px] text-subtle transition-colors hover:border-brand hover:text-brand disabled:opacity-40"
        >
          <Download size={11} aria-hidden />
          CSV
        </button>
      </div>

      {/* 与 stat-dialog 同一套 dt/dd 网格：标签在左、等宽数字右对齐 */}
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[12px]">
        {rows.map((row) => (
          <div key={row.label} className="contents">
            <dt className="text-subtle">{row.label}</dt>
            <dd className="text-right font-mono tabular-nums text-foreground">
              {row.value}
            </dd>
            {row.note && (
              <dd className="col-span-2 -mt-0.5 text-[10px] leading-relaxed text-subtle">
                {row.note}
              </dd>
            )}
          </div>
        ))}
      </dl>

      <p className="text-[10px] leading-relaxed text-subtle">
        数字来自后端 usage 事件，不含前端估算。usage 事件目前不带模型标识，
        成本按当前模型牌价折算。
      </p>
    </div>
  );
}
