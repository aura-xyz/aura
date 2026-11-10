/**
 * MCP 服务器资源浏览区（v0.8.1 · M2-04）。
 *
 * 挂在设置页详情抽屉里。资源 URI 由服务器给出、不可信：这里只展示与按需
 * 读取，绝不把内容注入对话上下文；模板项只展示不读取。
 */
import { useCallback, useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { FileText, RefreshCw, X } from "lucide-react";
import {
  listResources,
  readResource,
  resourceLabel,
  type McpResourceReadView,
  type McpResourceView,
} from "../lib/mcp";
import { formatBytes } from "../lib/filePreview";

export default function McpResourcePanel({
  serverId,
  supported,
}: {
  serverId: number;
  /** 服务器是否在握手时声明了 resources 域 */
  supported: boolean;
}) {
  const [items, setItems] = useState<McpResourceView[]>([]);
  const [preview, setPreview] = useState<McpResourceReadView | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      setItems(await listResources(serverId));
      setErr(null);
    } catch (e) {
      setErr(typeof e === "string" ? e : String(e));
    } finally {
      setBusy(false);
    }
  }, [serverId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function open(r: McpResourceView) {
    if (r.template) return;
    try {
      setPreview(await readResource(serverId, r.uri));
      setErr(null);
    } catch (e) {
      setErr(typeof e === "string" ? e : String(e));
    }
  }

  // 订阅更新只重读「正在看的那条」，避免一条资源变动就全量重扫。
  useEffect(() => {
    let un: (() => void) | undefined;
    let disposed = false;
    void listen<{ serverId: number; uri: string }>("mcp:resource", (e) => {
      if (e.payload.serverId !== serverId || !preview?.uri) return;
      if (e.payload.uri === preview.uri) {
        void readResource(serverId, preview.uri)
          .then(setPreview)
          .catch(() => {});
      }
    }).then((f) => {
      if (disposed) f();
      else un = f;
    });
    return () => {
      disposed = true;
      un?.();
    };
  }, [serverId, preview?.uri]);

  return (
    <section className="mt-5">
      <div className="flex items-center justify-between gap-2">
        <h3 className="eyebrow">资源清单</h3>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-subtle">{items.length} 条</span>
          <button
            type="button"
            onClick={() => void load()}
            disabled={busy}
            aria-label="刷新资源"
            title="刷新资源"
            className="rounded-tag p-1 text-subtle transition-colors hover:text-brand disabled:opacity-40"
          >
            <RefreshCw size={11} className={busy ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      {!supported && (
        <p className="mt-1.5 text-[10px] text-subtle">
          服务器未声明 resources 能力，可点「刷新资源」手动尝试。
        </p>
      )}
      {err && <p className="mt-2 text-[11px] text-danger">{err}</p>}

      {items.length === 0 ? (
        <p className="mt-2 text-[11px] text-subtle">暂无资源（未连接或服务器未提供）。</p>
      ) : (
        <ul className="mt-2 flex flex-col gap-1.5">
          {items.map((r) => (
            <li key={r.uri}>
              <button
                type="button"
                onClick={() => void open(r)}
                disabled={r.template}
                title={r.uri}
                className="flex w-full items-center gap-1.5 rounded-tag border border-line bg-surface px-2 py-1.5 text-left transition-colors hover:border-brand disabled:cursor-not-allowed disabled:opacity-50"
              >
                <FileText size={12} className="shrink-0 text-subtle" aria-hidden />
                <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-foreground">
                  {resourceLabel(r)}
                </span>
                {r.template && (
                  <span className="shrink-0 rounded-full border border-line px-1.5 py-0.5 text-[9px] text-subtle">
                    模板
                  </span>
                )}
                {r.mime_type && (
                  <span className="shrink-0 text-[9px] text-subtle">{r.mime_type}</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}

      {preview && (
        <div className="mt-3 rounded-tag border border-line bg-surface-sunken p-2">
          <div className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-foreground" title={preview.uri}>
              {preview.uri}
            </span>
            <button
              type="button"
              onClick={() => setPreview(null)}
              aria-label="关闭资源预览"
              className="shrink-0 rounded p-0.5 text-subtle hover:text-foreground"
            >
              <X size={11} />
            </button>
          </div>
          {preview.truncated && (
            <p className="mt-1 text-[10px] text-warning">
              内容已截断，共 {formatBytes(preview.total_bytes)}，仅显示前 {formatBytes(preview.text.length)}。
            </p>
          )}
          {preview.blob_bytes > 0 && (
            <p className="mt-1 text-[10px] text-subtle">
              另含 {formatBytes(preview.blob_bytes)} 二进制数据（未解码、不进入对话）。
            </p>
          )}
          <pre className="scrollbar-thin mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words font-mono text-[10px] leading-relaxed text-foreground">
            {preview.text || "（无文本内容）"}
          </pre>
        </div>
      )}
    </section>
  );
}
