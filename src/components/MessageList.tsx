import { memo, useCallback, useEffect, useState } from "react";
import { Pencil } from "lucide-react";
import { useStore, type Block, type ChatMessage } from "../store";
import { plainTextOf } from "../lib/messageText";
import { originalQuestion, userIndexForAssistant } from "../lib/history";
import { ActionRow, ErrorRow, NoticeRow } from "./ActionRow";
import Markdown from "./Markdown";
import MessageActions from "./MessageActions";
import { buildExampleCards, type ExampleCard } from "../lib/exampleCards";
import { listSkills } from "../lib/api";
import VersionSwitcher from "./VersionSwitcher";

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
          diff={block.diff}
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
  messageId,
  versions,
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
  /** 消息 id，供版本切换定位 */
  messageId?: string;
  /** 完整消息对象（含版本信息），供版本切换器渲染 */
  versions?: ChatMessage;
}) {
  const { switchMessageVersion } = useStore();

  const handleRegenerate = useCallback(() => {
    if (userIndex === undefined || question === undefined) return;
    onRegenerate(userIndex, question);
  }, [onRegenerate, userIndex, question]);

  const handleSwitch = useCallback(
    (index: number) => {
      if (!messageId) return;
      switchMessageVersion(messageId, index);
    },
    [messageId, switchMessageVersion],
  );

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
      <div className="flex flex-wrap items-center justify-end gap-2">
        {versions && <VersionSwitcher message={versions} onSwitch={handleSwitch} />}
        <MessageActions blocks={blocks} onRegenerate={handleRegenerate} />
      </div>
    </div>
  );
});

function EmptyState({
  cards,
  onPick,
}: {
  /** 示例卡片（v0.7.0）。为空则只显示极简欢迎语 */
  cards: ExampleCard[];
  /** 点卡片：把引导语填进输入框 */
  onPick: (prompt: string) => void;
}) {
  return (
    <div className="flex min-h-full items-center justify-center px-6">
      <div className="w-full max-w-2xl text-center">
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

        {/* v0.7.0：示例卡片。极简宣言说的是「视觉噪音少」，
            不是「没有内容」——空状态给几条能直接用的起点，
            比一句标语有用。卡片同时是技能入口。 */}
        {cards.length > 0 && (
          <div className="mt-6 flex flex-wrap justify-center gap-2">
            {cards.map((c) => (
              <button
                key={c.name}
                type="button"
                onClick={() => onPick(c.prompt)}
                className="group flex max-w-[16rem] flex-col items-start gap-0.5 rounded-card border border-line bg-surface px-3 py-2 text-left transition-colors hover:border-brand"
              >
                <span className="text-sm font-medium transition-colors group-hover:text-brand">
                  {c.title}
                </span>
                <span className="line-clamp-2 text-xs text-subtle">
                  {c.subtitle}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function MessageList() {
  const { activeSession, busy, resendFrom, insertIntoInput } = useStore();
  const messages = activeSession?.messages ?? [];

  // v0.7.0：空状态的示例卡片。内容从内置技能动态生成，
  // 后续加新技能卡片自动跟着变。
  const [cards, setCards] = useState<ExampleCard[]>([]);
  useEffect(() => {
    let cancelled = false;
    listSkills()
      .then((skills) => {
        if (!cancelled) setCards(buildExampleCards(skills));
      })
      .catch(() => {
        // 拿不到技能就只显示欢迎语，不报错——空状态不该有失败态
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * 重新生成的动作入口。所有 assistant 消息**共用这一个**——
   * 引用稳定是 memo 生效的前提（见 AssistantMessage 的注释）。
   * 具体是哪一条，由调用方以参数传进来。
   */
  const regenerate = useCallback(
    (userIndex: number, question: string) => {
      // archive: 旧回答归档为历史版本，用户可以切回去看
      void resendFrom(userIndex, question, { archive: true });
    },
    [resendFrom],
  );

  if (messages.length === 0) {
    return (
      <EmptyState
        cards={cards}
        onPick={(prompt) => insertIntoInput(prompt)}
      />
    );
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
              messageId={m.id}
              versions={m}
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
