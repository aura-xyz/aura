import { memo, useCallback } from "react";
import { Pencil } from "lucide-react";
import { useStore, type Block, type ChatMessage } from "../store";
import { plainTextOf } from "../lib/messageText";
import { originalQuestion, userIndexForAssistant } from "../lib/history";
import { ActionRow, ErrorRow, NoticeRow } from "./ActionRow";
import Markdown from "./Markdown";
import MessageActions from "./MessageActions";

// 以下两个组件必须 memo：store 的打字机每 30ms 触发一次 setState，
// 消息流里的每一条都会跟着重新 render。而 store 的 appendBlocks
// 对「非当前消息」保持对象引用不变（只 map 出新的顶层数组），
// 因此浅比较能拦住历史消息——连带其中的 Markdown 不会被重新解析。
// 没有 memo 时，长对话里历史越久、流式输出时越卡：任务越长越慢。
const UserBubble = memo(function UserBubble({
  content,
  userIndex,
}: {
  content: string;
  /**
   * 该消息是第几条用户消息（1-based）。
   *
   * 传**序号**而不是回调：回调每次渲染都是新函数，会让 memo 的浅比较
   * 失效，历史消息跟着重渲染——连带其中的 Markdown 被重新解析。
   * 动作由组件内部从 store 取。
   */
  userIndex: number;
}) {
  const { beginEdit } = useStore();
  return (
    <div className="group flex flex-col items-end gap-1">
      <div
        data-ctx-message={content}
        className="max-w-[75%] whitespace-pre-wrap break-words rounded-card bg-bubble-user px-4 py-3 text-[15px] leading-relaxed"
      >
        {content}
      </div>
      <div className="pointer-events-none flex justify-end opacity-0 transition-opacity duration-150 focus-within:pointer-events-auto focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100">
        <button
          type="button"
          onClick={() => beginEdit(userIndex, content)}
          aria-label="编辑这条消息"
          className="pointer-events-auto inline-flex items-center gap-1 rounded-md border border-line px-2 py-1 text-[11px] text-subtle transition-colors hover:border-brand hover:text-brand"
        >
          <Pencil size={12} className="shrink-0" />
          <span>编辑</span>
        </button>
      </div>
    </div>
  );
});

function renderBlock(block: Block, i: number) {
  switch (block.kind) {
    case "text":
      return <Markdown key={i} content={block.text} />;
    case "action":
      return (
        <ActionRow
          key={i}
          text={block.text}
          ok={block.ok}
          detail={block.detail}
          durationMs={block.durationMs}
        />
      );
    case "notice":
      return <NoticeRow key={i} text={block.text} />;
    case "error":
      return <ErrorRow key={i} text={block.text} />;
  }
}

const AssistantMessage = memo(function AssistantMessage({
  blocks,
  pending,
  userIndex,
  question,
  onRegenerate,
}: {
  blocks: Block[];
  pending: boolean;
  /** 触发这条回答的用户消息序号（1-based）；无则 undefined */
  userIndex?: number;
  /** 触发这条回答的原问题文本；无则 undefined */
  question?: string;
  /**
   * 重新生成的动作入口。由父级用 useCallback 统一提供，**引用稳定**。
   *
   * 不能在这里自己 useStore 取 actions：store 的 context value 每次
   * setState 都是新对象，订阅它等于每次打字机推进都重渲染，
   * memo 就白做了（MessageList.test.tsx 专门钉这条）。
   */
  onRegenerate: (userIndex: number, question: string) => void;
}) {
  const handleRegenerate = useCallback(() => {
    if (userIndex === undefined || question === undefined) return;
    onRegenerate(userIndex, question);
  }, [onRegenerate, userIndex, question]);

  if (blocks.length === 0) {
    // 仅等待首字期间显示呼吸光标；历史空消息不渲染
    if (!pending) return null;
    return (
      <div className="min-h-[1.6em] leading-relaxed">
        <span className="aura-breathing-cursor" aria-hidden="true" />
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3" data-ctx-message={plainTextOf(blocks)}>
      {blocks.map(renderBlock)}
      {/* 悬停才出现的操作条。放最后一行之下，不占用正文流 */}
      <MessageActions blocks={blocks} onRegenerate={handleRegenerate} />
    </div>
  );
});

function EmptyState() {
  return (
    <div className="flex min-h-full items-center justify-center">
      <div className="text-center">
        <img
          src="/logo.png"
          alt="Aura"
          draggable={false}
          className="mx-auto mb-3 h-16 w-16"
        />
        <h2 className="text-2xl font-semibold tracking-[-0.03em]">Aura</h2>
        <p className="mt-2 text-sm text-subtle">
          Minimal surface. Maximum logic.
        </p>
      </div>
    </div>
  );
}

export default function MessageList() {
  const { activeSession, busy, resendFrom } = useStore();
  const messages = activeSession?.messages ?? [];

  /**
   * 重新生成的动作入口。所有 assistant 消息**共用这一个**——
   * 引用稳定是 memo 生效的前提（见 AssistantMessage 的注释）。
   * 具体是哪一条，由调用方以参数传进来。
   */
  const regenerate = useCallback(
    (userIndex: number, question: string) => {
      void resendFrom(userIndex, question);
    },
    [resendFrom],
  );

  if (messages.length === 0) {
    return <EmptyState />;
  }

  const lastIndex = messages.length - 1;

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-6 py-6 xl:max-w-5xl 2xl:max-w-6xl">
      {messages.map((m, i) => {
        // 序号：界面消息的 1-based 位置（分角色各自计数）。
        // 重新生成/编辑都要用它们定位到对应的用户消息。
        const userIndex = countBefore(messages, i, "user");
        const assistantIndex = countBefore(messages, i, "assistant");

        if (m.role === "user") {
          return (
            <UserBubble key={i} content={m.content} userIndex={userIndex} />
          );
        }
        // 该回答由第几条用户消息触发，以及那个问题的原文。
        // 两个都是原始值/字符串引用，memo 浅比较能拦住。
        const srcUserIndex = userIndexForAssistant(messages, assistantIndex);
        const question =
          srcUserIndex === null ? undefined : originalQuestion(messages, srcUserIndex) ?? undefined;
        // group 让 MessageActions 的 group-hover 生效：指针进入这条消息
        // 整块才显示操作条，而不是只在按钮那一行生效
        return (
          <div key={i} className="group">
            <AssistantMessage
              blocks={m.blocks}
              pending={busy && i === lastIndex}
              userIndex={srcUserIndex ?? undefined}
              question={question}
              onRegenerate={regenerate}
            />
          </div>
        );
      })}
    </div>
  );
}

/** messages[0..before) 中该角色的条数（1-based 序号） */
function countBefore(
  messages: ChatMessage[],
  before: number,
  role: "user" | "assistant",
): number {
  let n = 0;
  for (let i = 0; i < before; i++) {
    if (messages[i].role === role) n += 1;
  }
  return n + 1;
}
