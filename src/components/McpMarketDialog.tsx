/**
 * MCP 服务器市场（v0.8.2 · M3-08）。
 *
 * 一键安装只写配置：后端固定「默认禁用 + 严格策略」，这里把这句如实
 * 写在确认区，避免用户以为点完就已经连上服务器。安装动作走二次确认，
 * 与技能市场安装前审查的交互口径一致。
 */
import { useEffect, useState } from "react";
import { Package, X } from "lucide-react";
import { useOverlay } from "../hooks/useOverlay";
import { marketInstall, marketList, type McpMarketEntry } from "../lib/mcp";

function message(e: unknown): string {
  return typeof e === "string" ? e : String(e);
}

export default function McpMarketDialog({
  onClose,
  onInstalled,
}: {
  onClose: () => void;
  onInstalled: () => void;
}) {
  const [items, setItems] = useState<McpMarketEntry[]>([]);
  const [confirm, setConfirm] = useState<McpMarketEntry | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useOverlay("mcp-market", true, onClose);

  useEffect(() => {
    let alive = true;
    void marketList()
      .then((v) => {
        if (alive) setItems(v);
      })
      .catch((e) => {
        if (alive) setErr(message(e));
      });
    return () => {
      alive = false;
    };
  }, []);

  async function install() {
    if (!confirm) return;
    setBusy(true);
    setErr(null);
    try {
      await marketInstall(confirm.id);
      onInstalled();
      onClose();
    } catch (e) {
      setErr(message(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      data-testid="mcp-market-dialog"
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-6"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="MCP 服务器市场"
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[80vh] w-full max-w-lg flex-col rounded-card border border-line bg-surface shadow-xl"
      >
        <div className="flex items-center gap-2 border-b border-line px-5 py-3">
          <Package size={15} className="text-subtle" aria-hidden />
          <h2 className="flex-1 text-sm font-semibold text-foreground">
            MCP 服务器市场
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭市场"
            className="rounded p-1 text-subtle hover:text-foreground"
          >
            <X size={14} />
          </button>
        </div>

        <div className="scrollbar-thin flex-1 overflow-auto p-4">
          {items.length === 0 ? (
            <p className="py-8 text-center text-[11px] text-subtle">
              暂无可用服务器
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {items.map((e) => (
                <li
                  key={e.id}
                  className="rounded-tag border border-line bg-surface-sunken px-3 py-2"
                >
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-foreground">
                      {e.name}
                    </span>
                    <span className="shrink-0 text-[9px] text-subtle">
                      {e.source === "builtin" ? "内置" : "远端"}
                    </span>
                    <button
                      type="button"
                      onClick={() => setConfirm(e)}
                      className="shrink-0 rounded-tag border border-line px-2 py-1 text-[10px] text-subtle hover:border-brand hover:text-brand"
                    >
                      安装
                    </button>
                  </div>
                  <p className="mt-1 text-[10px] leading-relaxed text-subtle">
                    {e.description}
                  </p>
                  <p className="mt-1 truncate font-mono text-[9px] text-subtle">
                    {e.server_url || `${e.command} ${e.args.join(" ")}`}
                  </p>
                </li>
              ))}
            </ul>
          )}

          {confirm && (
            <div
              data-testid="mcp-market-confirm"
              className="mt-3 rounded-tag border border-warning/40 bg-warning/10 p-3"
            >
              <p className="text-[11px] text-foreground">
                确认安装「{confirm.name}」？
              </p>
              <p className="mt-1 text-[10px] leading-relaxed text-subtle">
                只会写入配置：默认禁用、严格策略，不会自动连接或授权。
                启用前请先检查命令与参数，需要凭据时改用环境变量。
              </p>
              <div className="mt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setConfirm(null)}
                  className="rounded-tag border border-line px-2 py-1 text-[10px] text-subtle hover:text-foreground"
                >
                  取消
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void install()}
                  className="rounded-tag bg-brand px-2 py-1 text-[10px] text-white enabled:hover:bg-brand-strong disabled:opacity-40"
                >
                  确认安装
                </button>
              </div>
            </div>
          )}

          {err && <p className="mt-2 text-[11px] text-danger">{err}</p>}
        </div>

        <div className="border-t border-line px-5 py-3 text-[10px] text-subtle">
          清单来自内置条目与官方来源，失败时自动回退内置；安装前会做静态审查。
        </div>
      </div>
    </div>
  );
}
