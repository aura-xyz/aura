import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { ArrowUp, Square } from "lucide-react";
import type { ModelInfo } from "../lib/api";
import type { Mode } from "../lib/mode";
import ModeTabs from "./ModeTabs";
import ModelSelect from "./ModelSelect";
import WorkspaceSelect from "./WorkspaceSelect";

interface Props {
  onSend: (text: string) => void;
  onStop: () => void;
  busy: boolean;
  models: ModelInfo[];
  selectedModel: string;
  onModelChange: (id: string) => void;
  mode: Mode;
  onModeChange: (m: Mode) => void;
  /** 当前对话已绑定的工作区；空串表示尚未选定 */
  workspace: string;
  onWorkspaceChange: (path: string) => Promise<void>;
  /** 首条消息已发出：工作区锁定，隐藏选择按钮（一个对话唯一对应一个工作区） */
  workspaceLocked?: boolean;
}

export default function InputArea({
  onSend,
  onStop,
  busy,
  models,
  selectedModel,
  onModelChange,
  mode,
  onModeChange,
  workspace,
  onWorkspaceChange,
  workspaceLocked = false,
}: Props) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    const max = Math.floor(window.innerHeight / 3);
    el.style.height = `${Math.min(el.scrollHeight, max)}px`;
  }, [value]);

  function submit() {
    const text = value.trim();
    if (!text || busy) return;
    // 没定工作区就发不出去：后端拿不到执行目录，工具会落到默认目录。
    // 发送键同时置灰，这里拦住 Enter 快捷键那条路径。
    if (!workspace) return;
    onSend(text);
    setValue("");
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.nativeEvent.isComposing) return;
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  return (
    <div className="px-6 pb-5 pt-3">
      {/* 参考图版式：一个圆角卡片两段式——上半部输入区（最小两行高，
          单行时也保持舒展的留白），下半部工具行收入卡内；卡片外只放
          次级控件（工作区/模式/快捷键提示）。token 不变：圆角、细边框、
          轻阴影、focus 描边。 */}
      <div className="mx-auto flex w-full max-w-4xl xl:max-w-5xl 2xl:max-w-6xl flex-col rounded-card border border-line bg-surface px-4 py-3 shadow-xs transition-colors focus-within:border-brand focus-within:shadow-sm">
        <textarea
          ref={textareaRef}
          rows={1}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={
            mode === "plan"
              ? "描述你想做的事，先让 Aura 给出计划…"
              : mode === "build"
                ? "描述要执行的任务…"
                : "输入消息…"
          }
          className="max-h-[33vh] min-h-12 w-full resize-none overflow-y-auto bg-transparent py-0.5 text-[15px] leading-6 outline-none placeholder:text-subtle"
        />
        <div className="mt-1 flex items-center justify-between gap-2">
          {/* 工具行居左：模式胶囊（Chat/Plan/Build）。参考图此处是
              「添加上下文」的 +，本应用没有对应功能，用已有的模式切换
              补位——它本来就是每次发送时生效的核心开关。 */}
          <ModeTabs mode={mode} onChange={onModeChange} />
          <div className="flex shrink-0 items-center gap-2">
            <ModelSelect
              models={models}
              selectedModel={selectedModel}
              onChange={onModelChange}
            />
            {busy ? (
              <button
                type="button"
                onClick={onStop}
                aria-label="停止生成"
                className="rounded-full border border-line p-2 text-subtle transition-colors hover:bg-bubble hover:text-foreground"
              >
                <Square size={14} />
              </button>
            ) : (
              <button
                type="button"
                onClick={submit}
                disabled={!value.trim() || !workspace}
                aria-label={workspace ? "发送" : "请先选择工作区"}
                className="rounded-full bg-brand p-2 text-white transition-colors enabled:hover:bg-brand-strong disabled:opacity-30"
              >
                <ArrowUp size={14} />
              </button>
            )}
          </div>
        </div>
      </div>
      <div className="mx-auto mt-2 flex w-full max-w-4xl xl:max-w-5xl 2xl:max-w-6xl items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {/* 首条消息发出后工作区即锁定：按钮整体隐藏而非置灰——
              一个对话唯一对应一个工作区，没有「改」这个操作了。 */}
          {!workspaceLocked && (
            <WorkspaceSelect
              workspace={workspace}
              onChange={onWorkspaceChange}
            />
          )}
        </div>
        <p className="text-xs text-subtle">Enter 发送 · Shift+Enter 换行</p>
      </div>
    </div>
  );
}
