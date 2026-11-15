/**
 * 远程 MCP 服务器的授权对话框（v0.8.2 · M3-08）。
 *
 * M3-04 的授权面约定：后端生成 PKCE/state 并返回授权 URL，浏览器完成
 * 授权后用户从回环回调地址复制 code 交回 `mcp_oauth_complete`。
 * 这里是那段流程的 UI，不做任何 token 处理——明文凭据始终留在后端。
 */
import { useEffect, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ExternalLink, KeyRound, X } from "lucide-react";
import { useOverlay } from "../hooks/useOverlay";
import {
  oauthBegin,
  oauthClear,
  oauthComplete,
  oauthRefresh,
  type McpOAuthBeginView,
  type McpServerView,
} from "../lib/mcp";

function message(e: unknown): string {
  return typeof e === "string" ? e : String(e);
}

export default function McpOAuthDialog({
  server,
  onClose,
  onDone,
}: {
  server: McpServerView;
  onClose: () => void;
  onDone: () => void;
}) {
  const [begin, setBegin] = useState<McpOAuthBeginView | null>(null);
  const [code, setCode] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useOverlay("mcp-oauth", true, onClose);

  useEffect(() => {
    let alive = true;
    void oauthBegin(server.id)
      .then((v) => {
        if (alive) setBegin(v);
      })
      .catch((e) => {
        if (alive) setErr(message(e));
      });
    return () => {
      alive = false;
    };
  }, [server.id]);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setErr(null);
    try {
      await fn();
      onDone();
    } catch (e) {
      setErr(message(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      data-testid="mcp-oauth-dialog"
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-6"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`${server.name} 授权`}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-card border border-line bg-surface p-5 shadow-xl"
      >
        <div className="flex items-start gap-2">
          <KeyRound size={15} className="mt-0.5 shrink-0 text-subtle" aria-hidden />
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold text-foreground">
              {server.name} · 远程授权
            </h2>
            <p className="mt-1 text-[10px] leading-relaxed text-subtle">
              {server.has_token ? "已保存凭据" : "尚未授权"} · 凭据加密存储，不会回传到界面
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭授权"
            className="shrink-0 rounded p-1 text-subtle hover:text-foreground"
          >
            <X size={14} />
          </button>
        </div>

        {begin ? (
          <>
            <p className="mt-4 text-[11px] text-subtle">
              在浏览器打开授权页，完成后从 {begin.redirect_uri} 复制 <code>code</code> 粘贴到下面。
            </p>
            <div className="mt-2 flex items-center gap-2">
              <input
                readOnly
                value={begin.authorize_url}
                aria-label="授权地址"
                className="min-w-0 flex-1 rounded-tag border border-line bg-surface-sunken px-2 py-1.5 font-mono text-[10px] text-foreground"
              />
              <button
                type="button"
                onClick={() => void openUrl(begin.authorize_url)}
                className="flex shrink-0 items-center gap-1 rounded-tag border border-line px-2 py-1.5 text-[10px] text-subtle hover:text-brand"
              >
                <ExternalLink size={11} />
                打开
              </button>
            </div>
            <label className="mt-3 block">
              <span className="text-[11px] text-subtle">授权码（code）</span>
              <input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                aria-label="授权码"
                placeholder="粘贴浏览器回调中的 code"
                className="mt-1 w-full rounded-tag border border-line bg-surface px-2 py-1.5 font-mono text-[11px] text-foreground outline-none focus:border-brand"
              />
            </label>
          </>
        ) : (
          <p className="mt-4 text-[11px] text-subtle">正在生成授权地址…</p>
        )}

        {err && <p className="mt-2 text-[11px] text-danger">{err}</p>}

        <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
          {server.has_token && (
            <>
              <button
                type="button"
                disabled={busy}
                onClick={() => void run(() => oauthRefresh(server.id))}
                className="rounded-tag border border-line px-2.5 py-1.5 text-[11px] text-subtle hover:text-foreground disabled:opacity-40"
              >
                刷新凭据
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void run(() => oauthClear(server.id))}
                className="rounded-tag border border-danger/40 px-2.5 py-1.5 text-[11px] text-danger disabled:opacity-40"
              >
                撤销授权
              </button>
            </>
          )}
          <button
            type="button"
            onClick={onClose}
            className="rounded-tag border border-line px-2.5 py-1.5 text-[11px] text-subtle hover:text-foreground"
          >
            取消
          </button>
          <button
            type="button"
            disabled={busy || !begin || !code.trim()}
            onClick={() =>
              void run(() =>
                oauthComplete(server.id, code.trim(), begin!.state),
              )
            }
            className="rounded-tag bg-brand px-2.5 py-1.5 text-[11px] text-white enabled:hover:bg-brand-strong disabled:opacity-40"
          >
            完成授权
          </button>
        </div>
      </div>
    </div>
  );
}
