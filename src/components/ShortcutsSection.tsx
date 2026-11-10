/**
 * 快捷键设置分区（v0.8.1）。
 *
 * 键位表由 lib/shortcuts 持久化，这里只负责「看 / 录 / 校验 / 恢复」。
 * 录制用捕获阶段监听并 stopImmediatePropagation：按下 Ctrl+K 时不能让
 * 全局快捷键顺手把命令面板也打开，Esc 也不能把整个设置页关掉。
 */
import { useEffect, useState } from "react";
import { RotateCcw } from "lucide-react";
import { useShortcuts } from "../hooks/useShortcuts";
import {
  SHORTCUT_ACTIONS,
  comboFromEvent,
  formatShortcut,
  resetShortcuts,
  saveShortcuts,
  validateBinding,
  type ShortcutId,
} from "../lib/shortcuts";

const GROUPS = ["对话", "导航", "面板"] as const;

type Notice = { kind: "ok" | "error"; text: string } | null;

export default function ShortcutsSection() {
  const bindings = useShortcuts();
  const [recording, setRecording] = useState<ShortcutId | null>(null);
  const [notice, setNotice] = useState<Notice>(null);

  useEffect(() => {
    if (!recording) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      // 不止 stopPropagation：同一 window 上还有 App 的全局快捷键与设置页
      // 的 Escape 监听，必须把它们一并挡掉，否则录一次键会连带触发动作。
      e.stopImmediatePropagation();
      if (e.key === "Escape" && !e.ctrlKey && !e.altKey && !e.metaKey) {
        setRecording(null);
        setNotice(null);
        return;
      }
      if (e.isComposing) return;
      const combo = comboFromEvent(e);
      if (!combo) return; // 只按了修饰键，继续等主键
      const binding = formatShortcut(combo);
      const error = validateBinding(recording, binding, bindings);
      if (error) {
        // 保留录制态，用户可以直接换一个组合重试
        setNotice({ kind: "error", text: error });
        return;
      }
      saveShortcuts({ ...bindings, [recording]: binding });
      setRecording(null);
      setNotice({ kind: "ok", text: "键位已更新，立即生效" });
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [recording, bindings]);

  function toggleRecord(id: ShortcutId) {
    setNotice(null);
    setRecording((cur) => (cur === id ? null : id));
  }

  function resetOne(id: ShortcutId) {
    const def = SHORTCUT_ACTIONS.find((a) => a.id === id)?.default;
    if (!def) return;
    const error = validateBinding(id, def, bindings);
    if (error) {
      setNotice({ kind: "error", text: error });
      return;
    }
    saveShortcuts({ ...bindings, [id]: def });
    setNotice({ kind: "ok", text: "已恢复该动作的默认键位" });
  }

  function resetAll() {
    resetShortcuts();
    setRecording(null);
    setNotice({ kind: "ok", text: "已恢复全部默认键位" });
  }

  return (
    <section className="rounded-card border border-line p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="eyebrow">键盘快捷键</h2>
          <p className="mt-2 text-xs leading-relaxed text-subtle">
            点击「更改」后直接按下想要的组合键，Esc 取消。修改立即生效并保存在本机。
            为避免影响输入与系统操作，纯按键以及 Ctrl+C / V / A / Z、Ctrl+R
            等常用组合不可绑定；刷新与开发者工具拦截是固定保护，不在此列。
          </p>
        </div>
        <button
          type="button"
          onClick={resetAll}
          className="flex shrink-0 items-center gap-1.5 rounded-tag border border-line px-2.5 py-1.5 text-xs text-subtle transition-colors hover:border-brand hover:text-brand"
        >
          <RotateCcw size={12} />
          恢复默认
        </button>
      </div>

      {notice && (
        <p
          role={notice.kind === "error" ? "alert" : "status"}
          className={`mt-4 rounded-tag px-3 py-2 text-xs ${
            notice.kind === "error"
              ? "bg-danger/10 text-danger"
              : "bg-success/10 text-success"
          }`}
        >
          {notice.text}
        </p>
      )}

      {GROUPS.map((group) => (
        <div key={group} className="mt-6">
          <h3 className="text-[11px] font-medium tracking-wide text-subtle">{group}</h3>
          <div className="mt-1">
            {SHORTCUT_ACTIONS.filter((a) => a.group === group).map((a) => {
              const value = bindings[a.id];
              const isRecording = recording === a.id;
              return (
                <div
                  key={a.id}
                  className="flex items-center justify-between gap-3 border-b border-line py-2.5 last:border-b-0"
                >
                  <span className="min-w-0 text-sm">{a.label}</span>
                  <div className="flex shrink-0 items-center gap-2">
                    {isRecording ? (
                      <span className="rounded-tag border border-brand px-2 py-1 text-[11px] text-brand">
                        请按下组合键…
                      </span>
                    ) : (
                      <kbd className="min-w-[5rem] rounded-tag border border-line bg-surface-sunken px-2 py-1 text-center font-mono text-[11px] text-foreground">
                        {value}
                      </kbd>
                    )}
                    <button
                      type="button"
                      onClick={() => toggleRecord(a.id)}
                      aria-pressed={isRecording}
                      className="rounded-tag border border-line px-2 py-1 text-[11px] text-subtle transition-colors hover:border-brand hover:text-brand"
                    >
                      {isRecording ? "取消" : "更改"}
                    </button>
                    <button
                      type="button"
                      onClick={() => resetOne(a.id)}
                      disabled={value === a.default}
                      aria-label={`恢复「${a.label}」的默认键位`}
                      title="恢复默认键位"
                      className="rounded-tag p-1 text-subtle transition-colors hover:text-brand disabled:cursor-not-allowed disabled:opacity-30"
                    >
                      <RotateCcw size={12} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </section>
  );
}
