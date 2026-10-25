import { memo } from "react";
import { useStore, type Block } from "../store";
import { plainTextOf } from "../lib/messageText";
import { ActionRow, ErrorRow, NoticeRow } from "./ActionRow";
import Markdown from "./Markdown";

// 以下两个组件必须 memo：store 的打字机每 30ms 触发一次 setState，
// 消息流里的每一条都会跟着重新 render。而 store 的 appendBlocks
// 对「非当前消息」保持对象引用不变（只 map 出新的顶层数组），
// 因此浅比较能拦住历史消息——连带其中的 Markdown 不会被重新解析。
// 没有 memo 时，长对话里历史越久、流式输出时越卡：任务越长越慢。
const UserBubble = memo(function UserBubble({ content }: { content: string }) {
  return (
    <div className="flex justify-end">
      {/* 品牌蓝浅底是「归属」锚点：AI 侧维持灰底，对话归属一眼可辨。
          色值与灰底的可辨识度由 lib/contrast.test.ts 钉住。
          data-ctx-message 供全局右键定位，值是要复制的纯文本。 */}
      <div
        data-ctx-message={content}
        className="max-w-[75%] whitespace-pre-wrap break-words rounded-card bg-bubble-user px-4 py-3 text-[15px] leading-relaxed"
      >
        {content}
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
}: {
  blocks: Block[];
  pending: boolean;
}) {
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
  const { activeSession, busy } = useStore();
  const messages = activeSession?.messages ?? [];

  if (messages.length === 0) {
    return <EmptyState />;
  }

  const lastIndex = messages.length - 1;

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-6 py-6 xl:max-w-5xl 2xl:max-w-6xl">
      {messages.map((m, i) =>
        m.role === "user" ? (
          <UserBubble key={i} content={m.content} />
        ) : (
          <AssistantMessage
            key={i}
            blocks={m.blocks}
            pending={busy && i === lastIndex}
          />
        ),
      )}
    </div>
  );
}
