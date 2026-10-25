import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { ArrowUp, Square } from "lucide-react";
import type { ModelInfo } from "../lib/api";
import type { Mode } from "../lib/mode";
import { estimateTokens } from "../lib/tokens";
import { loadInputDraft, saveInputDraft } from "../lib/draft";
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
  /** 当前会话 id。草稿按会话隔离，切换对话各自保留 */
  sessionId: string;
  /** 最近一条用户消息，供上方向键召回 */
  lastUserMessage?: string;
  /** 编辑历史消息时要把原文放回输入框；null 表示不在编辑 */
  editPrefill?: string | null;
  /** 正在编辑：输入框展示提示条，发送走「回滚 + 重发」 */
  editing?: boolean;
  /** 取消编辑 */
  onCancelEdit?: () => void;
  /**
   * 提交入口。普通发送与「编辑后重发」由 store 内部区分，
   * 输入框只调这一个。
   */
  onSubmit?: (text: string) => void;
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
  sessionId,
  lastUserMessage,
  editPrefill = null,
  editing = false,
  onCancelEdit,
  onSubmit,
}: Props) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // 草稿是「切换会话时换内容」，必须知道当前显示的是哪个会话的草稿，
  // 否则会把上个会话的草稿写进新会话。
  const loadedForRef = useRef<string | null>(null);

  // 切会话：装入该会话的草稿
  useEffect(() => {
    if (loadedForRef.current === sessionId) return;
    loadedForRef.current = sessionId;
    setValue(loadInputDraft(sessionId));
  }, [sessionId]);

  // 编辑历史消息：原文放回输入框。
  // 刻意不写进草稿——草稿是「用户正在写的东西」，编辑态的原文是
  // 系统填的，存进去会在下次切会话时莫名其妙冒出来。
  useEffect(() => {
    if (editPrefill === null) return;
    setValue(editPrefill);
  }, [editPrefill]);

  // 每次输入即存。不节流：localStorage 同步写，输入频率下量级可接受
  useEffect(() => {
    if (loadedForRef.current !== sessionId) return;
    saveInputDraft(sessionId, value);
  }, [value, sessionId]);

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
    if (onSubmit) {
      onSubmit(text);
    } else {
      onSend(text);
    }
    setValue("");
    saveInputDraft(sessionId, "");
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.nativeEvent.isComposing) return;
    // 上方向键召回上一条输入。仅在输入框为空时生效——
    // 非空时方向键要留给光标移动，抢过来会让用户无法编辑中间内容。
    if (e.key === "ArrowUp" && !value && lastUserMessage) {
      e.preventDefault();
      setValue(lastUserMessage);
      return;
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  return (
    <div className="px-6 pb-5 pt-3">
      {/* 编辑历史消息时的提示条。放在卡片上方，说明「这次发送会替换哪一条」——
          没有它用户不知道发出去会发生什么。 */}
      {editing && (
        <div className="mx-auto mb-2 flex w-full max-w-4xl xl:max-w-5xl 2xl:max-w-6xl items-center justify-between gap-2 rounded-card border border-brand bg-bubble-user px-3 py-1.5 text-xs">
          <span className="text-foreground">正在编辑之前的消息，发送后将替换它</span>
          {onCancelEdit && (
            <button
              type="button"
              onClick={onCancelEdit}
              className="shrink-0 rounded-md border border-line px-2 py-0.5 text-[11px] text-subtle transition-colors hover:border-brand hover:text-brand"
            >
              取消
            </button>
          )}
        </div>
      )}
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
        {/* 工具行。flex-wrap：窄屏时右侧的控件折行而不是被挤掉。
            工作区与模型挨在一起——它们都是「这次任务在哪儿、用什么」，
            分散在两行反而要来回扫。 */}
        <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
          {/* 工具行居左：模式胶囊（Chat/Plan/Build）。参考图此处是
              「添加上下文」的 +，本应用没有对应功能，用已有的模式切换
              补位——它本来就是每次发送时生效的核心开关。 */}
          <ModeTabs mode={mode} onChange={onModeChange} />
          {/* 右侧组用 min-w-0 而非 shrink-0：模型名可能很长，
              固定不收缩会把工作区按钮挤出可视区。 */}
          <div className="flex min-w-0 items-center gap-3">
            {/* 首条消息发出后工作区即锁定：按钮整体隐藏而非置灰——
                一个对话唯一对应一个工作区，没有「改」这个操作了。 */}
            {!workspaceLocked && (
              <WorkspaceSelect
                workspace={workspace}
                onChange={onWorkspaceChange}
              />
            )}
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
      <div className="mx-auto mt-2 flex w-full max-w-4xl xl:max-w-5xl 2xl:max-w-6xl items-center justify-end gap-3">
        {/* 令牌计数：只在有内容时出现，空输入框不显示数字（0 没有信息量）。
            口径与后端 estimate_tokens 一致，见 lib/tokens.ts。 */}
        {value.trim() && (
          <span className="text-xs text-subtle" title="按后端同口径估算">
            约 {estimateTokens(value)} tokens
          </span>
        )}
        <p className="text-xs text-subtle">Enter 发送 · Shift+Enter 换行</p>
      </div>
    </div>
  );
}
