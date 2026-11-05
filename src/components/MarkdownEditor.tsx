/**
 * 输入框内 Markdown 所见即所得（v0.8.0）。
 *
 * Lexical 负责 IME、光标与撤销栈；MarkdownShortcutPlugin 在输入时把
 * `# `、`**`、``` 等语法即时转成对应节点，`$convertToMarkdownString`
 * 保证发出去的仍是原始 Markdown，而不是 HTML。
 *
 * 外部写入（切会话草稿、编辑回填、发送后清空、命令替换）统一打
 * PROGRAMMATIC_TAG：输入框据此只同步文本、不重新弹触发面板，
 * 否则「清空后光标落在文首」会被误判成新的 `/` 触发。
 */
import {
  useEffect,
  type KeyboardEvent as ReactKeyboardEvent,
  type MutableRefObject,
  type ReactNode,
} from "react";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { MarkdownShortcutPlugin } from "@lexical/react/LexicalMarkdownShortcutPlugin";
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $convertFromMarkdownString,
  $convertToMarkdownString,
  TRANSFORMERS,
} from "@lexical/markdown";
import {
  $getSelection,
  $isRangeSelection,
  $isTextNode,
  type EditorState,
  type LexicalEditor,
} from "lexical";
import { HeadingNode, QuoteNode } from "@lexical/rich-text";
import { ListItemNode, ListNode } from "@lexical/list";
import { CodeHighlightNode, CodeNode } from "@lexical/code";
import { AutoLinkNode, LinkNode } from "@lexical/link";

/** 由程序写入编辑器内容的更新标签。 */
export const PROGRAMMATIC_TAG = "aura-programmatic";

const NODES = [
  HeadingNode,
  QuoteNode,
  ListNode,
  ListItemNode,
  CodeNode,
  CodeHighlightNode,
  LinkNode,
  AutoLinkNode,
];

const THEME = {
  paragraph: "my-1",
  heading: {
    h1: "text-xl font-semibold my-2",
    h2: "text-lg font-semibold my-2",
    h3: "text-base font-semibold my-1",
  },
  quote: "border-l-2 border-line pl-3 text-subtle my-2",
  list: { ul: "list-disc pl-5", ol: "list-decimal pl-5", listitem: "my-0.5" },
  text: {
    bold: "font-semibold",
    italic: "italic",
    code: "rounded bg-bubble px-1 font-mono",
  },
  code: "block rounded-md bg-bubble p-2 font-mono text-xs whitespace-pre-wrap my-2",
};

export interface EditorSnapshot {
  /** 光标所在文本节点的纯文本，供 @// 触发判定 */
  line: string;
  /** 光标在该文本节点内的偏移 */
  caret: number;
  /** 序列化后的 Markdown，用于发送与草稿 */
  markdown: string;
}

export function readSnapshot(state: EditorState): EditorSnapshot {
  let line = "";
  let caret = 0;
  let markdown = "";
  state.read(() => {
    markdown = $convertToMarkdownString(TRANSFORMERS);
    const sel = $getSelection();
    if ($isRangeSelection(sel)) {
      const node = sel.anchor.getNode();
      line = node.getTextContent();
      caret = sel.anchor.offset;
    }
  });
  return { line, caret, markdown };
}

export function editorMarkdown(editor: LexicalEditor): string {
  let md = "";
  editor.getEditorState().read(() => {
    md = $convertToMarkdownString(TRANSFORMERS);
  });
  return md;
}

/** 整体替换编辑器内容（草稿、回填、清空）。内部会清 root，不必先手动 clear。 */
export function setEditorMarkdown(editor: LexicalEditor, text: string): void {
  editor.update(
    () => {
      $convertFromMarkdownString(text, TRANSFORMERS);
    },
    { discrete: true, tag: PROGRAMMATIC_TAG },
  );
}

/** 在当前光标处插入文本（加号面板里选技能时用）。 */
export function insertAtCaret(editor: LexicalEditor, text: string): void {
  editor.update(
    () => {
      const sel = $getSelection();
      if ($isRangeSelection(sel)) sel.insertText(text);
    },
    { discrete: true, tag: PROGRAMMATIC_TAG },
  );
}

/** 替换触发词（`/sk`、`@fi`）为选中项插入的文本。 */
export function replaceTrigger(
  editor: LexicalEditor,
  start: number,
  end: number,
  insert: string,
  programmatic = false,
): void {
  // 选中根命令插入 `/skill ` 时 programmatic=false：下一次 OnChange 要
  // 重新解析出「已进入技能二级面板」，面板状态仍由输入框文本驱动。
  // 其余替换打标签，避免把插入后的光标误判成新的触发。
  editor.update(
    () => {
      const sel = $getSelection();
      if (!$isRangeSelection(sel)) return;
      const node = sel.anchor.getNode();
      if ($isTextNode(node)) {
        sel.anchor.set(node.getKey(), start, "text");
        sel.focus.set(node.getKey(), end, "text");
      }
      sel.insertText(insert);
    },
    { discrete: true, tag: programmatic ? PROGRAMMATIC_TAG : undefined },
  );
}

function EditorBridge({
  editorRef,
}: {
  editorRef: MutableRefObject<LexicalEditor | null>;
}) {
  const [editor] = useLexicalComposerContext();
  useEffect(() => {
    editorRef.current = editor;
    return () => {
      editorRef.current = null;
    };
  }, [editor, editorRef]);
  return null;
}

export default function MarkdownEditor({
  initialValue,
  editorRef,
  onChange,
  onKeyDown,
  placeholder,
}: {
  initialValue: string;
  editorRef: MutableRefObject<LexicalEditor | null>;
  onChange: (snapshot: EditorSnapshot, programmatic: boolean) => void;
  onKeyDown: (e: ReactKeyboardEvent<HTMLElement>) => void;
  placeholder: ReactNode;
}) {
  return (
    <LexicalComposer
      initialConfig={{
        namespace: "AuraInput",
        nodes: NODES,
        theme: THEME,
        // 只在 composer 创建时求值一次：草稿是挂载时就该显示的内容，
        // 后续变化走 setEditorMarkdown，不重建编辑器。
        editorState: initialValue
          ? () => {
              $convertFromMarkdownString(initialValue, TRANSFORMERS);
            }
          : undefined,
        onError: (error) => {
          throw error;
        },
      }}
    >
      {/* onKeyDownCapture 是必须的：Lexical 在 contentEditable 上挂了原生
          keydown 监听（目标阶段先于 React 委托的冒泡 handler）。若把回车
          处理放在 ContentEditable 的 onKeyDown 上，Lexical 会先插一个段落
          再轮到我们发送。捕获阶段在事件到达目标之前，配合
          stopPropagation 才能让「Enter 发送 / Tab 切模式 / 浮层方向键」
          真正归输入框管。 */}
      <div className="aura-md-editor relative" onKeyDownCapture={onKeyDown}>
        <EditorBridge editorRef={editorRef} />
        <RichTextPlugin
          contentEditable={
            <ContentEditable
              role="textbox"
              aria-label="消息输入框"
              aria-multiline
              className="max-h-[33vh] min-h-12 w-full overflow-y-auto py-0.5 text-base leading-6 outline-none"
            />
          }
          placeholder={
            <div className="pointer-events-none absolute left-0 top-2 text-base text-subtle">
              {placeholder}
            </div>
          }
          ErrorBoundary={LexicalErrorBoundary}
        />
        <HistoryPlugin />
        <MarkdownShortcutPlugin transformers={TRANSFORMERS} />
        <OnChangePlugin
          ignoreSelectionChange
          onChange={(state, editor, tags) => {
            if (tags.has(PROGRAMMATIC_TAG)) {
              onChange(
                { line: "", caret: 0, markdown: editorMarkdown(editor) },
                true,
              );
              return;
            }
            onChange(readSnapshot(state), false);
          }}
        />
      </div>
    </LexicalComposer>
  );
}
