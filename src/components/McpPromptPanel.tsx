/**
 * MCP 提示词区（v0.8.1 · M2-06），挂在设置页详情抽屉里。
 *
 * 这里只做「清单 + 参数说明 + 展开预览」，不负责把内容送进对话：
 * 实际插入走输入框的 `/` 命令面板（那里才有输入框实例）。
 * 预览内容是不可信文本，只展示、不执行。
 */
import { useCallback, useEffect, useState } from "react";
import { RefreshCw, Sparkles } from "lucide-react";
import {
  getPrompt,
  listPrompts,
  promptPlainText,
  type McpPromptView,
} from "../lib/mcp";

export default function McpPromptPanel({
  serverId,
  supported,
}: {
  serverId: number;
  /** 服务器是否在握手时声明了 prompts 域 */
  supported: boolean;
}) {
  const [items, setItems] = useState<McpPromptView[]>([]);
  const [selected, setSelected] = useState<McpPromptView | null>(null);
  const [args, setArgs] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      setItems(await listPrompts(serverId));
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

  async function expand(p: McpPromptView, values: Record<string, string>) {
    try {
      const messages = await getPrompt(serverId, p.name, values);
      setPreview(promptPlainText(messages) || "（服务器返回了空内容）");
      setErr(null);
    } catch (e) {
      setErr(typeof e === "string" ? e : String(e));
    }
  }

  function pick(p: McpPromptView) {
    setSelected(p);
    setArgs(Object.fromEntries(p.arguments.map((a) => [a.name, ""])));
    setPreview(null);
    if (p.arguments.length === 0) void expand(p, {});
  }

  return (
    <section className="mt-5">
      <div className="flex items-center justify-between gap-2">
        <h3 className="eyebrow">提示词清单</h3>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-subtle">{items.length} 条</span>
          <button
            type="button"
            onClick={() => void load()}
            disabled={busy}
            aria-label="刷新提示词"
            title="刷新提示词"
            className="rounded-tag p-1 text-subtle transition-colors hover:text-brand disabled:opacity-40"
          >
            <RefreshCw size={11} className={busy ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      {!supported && (
        <p className="mt-1.5 text-[10px] text-subtle">
          服务器未声明 prompts 能力，可点「刷新提示词」手动尝试。
        </p>
      )}
      {err && <p className="mt-2 text-[11px] text-danger">{err}</p>}

      {items.length === 0 ? (
        <p className="mt-2 text-[11px] text-subtle">暂无提示词（未连接或服务器未提供）。</p>
      ) : (
        <ul className="mt-2 flex flex-col gap-1.5">
          {items.map((p) => (
            <li key={p.name}>
              <button
                type="button"
                onClick={() => pick(p)}
                className="flex w-full items-center gap-1.5 rounded-tag border border-line bg-surface px-2 py-1.5 text-left transition-colors hover:border-brand"
              >
                <Sparkles size={12} className="shrink-0 text-subtle" aria-hidden />
                <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-foreground">
                  {p.name}
                </span>
                {p.arguments.length > 0 && (
                  <span className="shrink-0 text-[9px] text-subtle">
                    {p.arguments.length} 个参数
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}

      {selected && (
        <div className="mt-3 rounded-tag border border-line bg-surface-sunken p-2">
          <p className="font-mono text-[10px] text-foreground">{selected.name}</p>
          {selected.description && (
            <p className="mt-1 text-[10px] text-subtle">{selected.description}</p>
          )}
          {selected.arguments.map((a) => (
            <label key={a.name} className="mt-2 block">
              <span className="text-[10px] text-foreground">
                {a.name}
                {a.required && <span className="ml-0.5 text-danger">*</span>}
              </span>
              {a.description && (
                <span className="ml-1 text-[9px] text-subtle">{a.description}</span>
              )}
              <input
                value={args[a.name] ?? ""}
                onChange={(e) =>
                  setArgs((v) => ({ ...v, [a.name]: e.target.value }))
                }
                aria-label={`${selected.name} 的 ${a.name}`}
                className="mt-1 w-full rounded-tag border border-line bg-surface px-2 py-1 text-[11px] text-foreground outline-none focus:border-brand"
              />
            </label>
          ))}
          <button
            type="button"
            onClick={() => void expand(selected, args)}
            className="mt-2 rounded-tag border border-line px-2 py-1 text-[10px] text-subtle hover:border-brand hover:text-brand"
          >
            展开预览
          </button>
          {preview !== null && (
            <pre className="scrollbar-thin mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono text-[10px] leading-relaxed text-foreground">
              {preview}
            </pre>
          )}
          <p className="mt-2 text-[9px] text-subtle">
            预览内容仅展示；要在对话里使用，请在输入框输入 / 选对应提示词。
          </p>
        </div>
      )}
    </section>
  );
}
