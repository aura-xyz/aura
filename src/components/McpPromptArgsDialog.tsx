/**
 * `/` 命令面板选中 MCP 提示词后的参数表单（v0.8.1 · M2-06）。
 *
 * 做成独立浮层而不是塞进 CommandMenu 的 header：输入框的 handleKeyDown
 * 会抢走方向键/回车，参数输入必须在自己的 DOM 里才不会被键盘导航吞掉。
 * 入浮层栈后 Esc 只关它，不会顺手把命令面板或设置页也关掉。
 */
import { useState } from "react";
import { X } from "lucide-react";
import { useOverlay } from "../hooks/useOverlay";
import type { McpPromptItemView } from "../lib/mcp";

export default function McpPromptArgsDialog({
  prompt,
  onSubmit,
  onCancel,
}: {
  prompt: McpPromptItemView;
  onSubmit: (args: Record<string, string>) => void;
  onCancel: () => void;
}) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(prompt.arguments.map((a) => [a.name, ""])),
  );

  useOverlay("mcp-prompt-args", true, onCancel);

  const missing = prompt.arguments
    .filter((a) => a.required && !(values[a.name] ?? "").trim())
    .map((a) => a.name);

  function submit() {
    if (missing.length) return;
    const args: Record<string, string> = {};
    for (const a of prompt.arguments) {
      const v = (values[a.name] ?? "").trim();
      if (v) args[a.name] = v;
    }
    onSubmit(args);
  }

  return (
    <div
      data-testid="mcp-prompt-dialog"
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-6"
      onClick={onCancel}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`${prompt.name} 参数`}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-card border border-line bg-surface p-5 shadow-xl"
      >
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold text-foreground">
              {prompt.server_name} / {prompt.name}
            </h2>
            {prompt.description && (
              <p className="mt-1 text-[11px] leading-relaxed text-subtle">
                {prompt.description}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onCancel}
            aria-label="取消插入提示词"
            className="shrink-0 rounded p-1 text-subtle hover:text-foreground"
          >
            <X size={14} />
          </button>
        </div>

        <div className="mt-4 flex flex-col gap-3">
          {prompt.arguments.map((a) => (
            <label key={a.name} className="block">
              <span className="text-[11px] font-medium text-foreground">
                {a.name}
                {a.required && <span className="ml-0.5 text-danger">*</span>}
              </span>
              {a.description && (
                <span className="ml-1.5 text-[10px] text-subtle">{a.description}</span>
              )}
              <input
                value={values[a.name] ?? ""}
                onChange={(e) =>
                  setValues((v) => ({ ...v, [a.name]: e.target.value }))
                }
                onKeyDown={(e) => {
                  if (e.key === "Enter") submit();
                }}
                aria-label={a.name}
                className="mt-1 w-full rounded-tag border border-line bg-surface-sunken px-2 py-1.5 text-xs text-foreground outline-none focus:border-brand"
              />
            </label>
          ))}
        </div>

        {missing.length > 0 && (
          <p className="mt-2 text-[10px] text-subtle">
            必填：{missing.join("、")}
          </p>
        )}

        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-tag border border-line px-3 py-1.5 text-xs text-subtle hover:text-foreground"
          >
            取消
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={missing.length > 0}
            className="rounded-tag bg-brand px-3 py-1.5 text-xs text-white enabled:hover:bg-brand-strong disabled:opacity-40"
          >
            插入输入框
          </button>
        </div>
      </div>
    </div>
  );
}
