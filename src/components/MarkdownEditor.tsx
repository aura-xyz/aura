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
  $generateNodesFromMarkdownString,
  TRANSFORMERS,
} from "@lexical/markdown";
import {
  $findMatchingParent,
  $getRoot,
  $getSelection,
  $isParagraphNode,
  $isRangeSelection,
  $isTextNode,
  COMMAND_PRIORITY_HIGH,
  PASTE_COMMAND,
  type EditorState,
  type LexicalEditor,
  type PasteCommandType,
} from "lexical";
import { HeadingNode, QuoteNode } from "@lexical/rich-text";
import { $isListNode, ListItemNode, ListNode } from "@lexical/list";
import { $isCodeNode, CodeHighlightNode, CodeNode } from "@lexical/code";
import { AutoLinkNode, LinkNode } from "@lexical/link";
import { isMarkdownPaste } from "../lib/markdownPaste";

/** 由程序写入编辑器内容的更新标签。 */
export const PROGRAMMATIC_TAG = "aura-programmatic";

/**
 * 粘贴处理必须跑在 @lexical/rich-text 的默认粘贴（EDITOR=0）之前：
 * 真实浏览器里光标在输入框，默认处理器会按纯文本插入并 return true，
 * 排在它后面的 Markdown 解析根本轮不到。取 HIGH 是为了不与将来新增的
 * 同级处理器竞争。导出成常量让「高于 EDITOR」这条约束可单测 ——
 * jsdom 里编辑器未聚焦、默认处理器不拦截，光靠粘贴结果测试碰巧也能过。
 */
export const MARKDOWN_PASTE_PRIORITY = COMMAND_PRIORITY_HIGH;

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
  list: {
    ul: "list-disc pl-5",
    ol: "list-decimal pl-5",
    listitem: "my-0.5",
    // CHECK_LIST 在 TRANSFORMERS 里，勾选态也要有可见样式，
    // 否则 - [x] 粘进来后和普通列表项长得一样
    listitemChecked: "my-0.5 list-none pl-5 line-through text-subtle",
    listitemUnchecked: "my-0.5 list-none pl-5",
    nested: { listitem: "list-none" },
  },
  text: {
    bold: "font-semibold",
    italic: "italic",
    strikethrough: "line-through text-subtle",
    underline: "underline",
    code: "rounded bg-bubble px-1 font-mono",
  },
  link: "text-link underline decoration-link/40 underline-offset-2",
  code: "block rounded-md bg-bubble p-2 font-mono text-xs whitespace-pre-wrap my-2",
};

export interface EditorSnapshot {
  /** 光标所在文本节点的纯文本，供 @// 触发判定 */
  line: string;
  /** 光标在该文本节点内的偏移 */
  caret: number;
  /** 序列化后的 Markdown，用于发送与草稿 */
  markdown: string;
  /** 光标在列表 / 代码块里：Tab 应交给 Lexical 缩进，而不是切会话模式 */
  indentable: boolean;
}

export function readSnapshot(state: EditorState): EditorSnapshot {
  let line = "";
  let caret = 0;
  let markdown = "";
  let indentable = false;
  state.read(() => {
    // 导出保持默认（段落间空行分隔），否则多个段落会被压成一行。
    markdown = $convertToMarkdownString(TRANSFORMERS);
    const sel = $getSelection();
    if (!$isRangeSelection(sel)) return;
    const node = sel.anchor.getNode();
    // 光标落在 ElementNode（空段落、列表项、代码块）时，anchor.offset 是
    // **子节点索引**而不是文本偏移；拿它去找触发符会完全错位。这类节点
    // 一律当作「没有触发」，等用户真的敲进文本节点再判定。
    if ($isTextNode(node)) {
      line = node.getTextContent();
      caret = sel.anchor.offset;
    }
    indentable =
      $findMatchingParent(
        node,
        (parent) => $isListNode(parent) || $isCodeNode(parent),
      ) !== null;
  });
  return { line, caret, markdown, indentable };
}

export function editorMarkdown(editor: LexicalEditor): string {
  let md = "";
  editor.getEditorState().read(() => {
    md = $convertToMarkdownString(TRANSFORMERS);
  });
  return md;
}

/**
 * 把 Markdown 灌进编辑器（草稿、回填、清空）。
 *
 * 必须用**默认**的 normalizeMarkdown：实测 `第一行\n第二行` 经默认的
 * import + export 能原样往返，而传 shouldPreserveNewLines=true 会把它
 * 拆成两个段落、导出成 `第一行\n\n第二行`，反而在草稿重载时多出空行。
 * 别为了「保留换行」去动这个参数，回归测试在 MarkdownEditor.test.tsx。
 */
function $importMarkdown(text: string): void {
  $convertFromMarkdownString(text, TRANSFORMERS);
}

/** 整体替换编辑器内容（草稿、回填、清空）。内部会清 root，不必先手动 clear。 */
export function setEditorMarkdown(editor: LexicalEditor, text: string): void {
  editor.update(
    () => {
      $importMarkdown(text);
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

/**
 * 粘贴 Markdown 时按语法解析，而不是留一坨井号星号。
 *
 * 走 Lexical 的 PASTE_COMMAND 而不是 React onPaste：优先级必须高于
 * @lexical/rich-text 的默认粘贴处理，否则它先按纯文本插入并 return true；
 * 普通文本则主动 return false 交回默认路径（保留空格、避免误伤）。
 * 单段落的内联语法只插子节点，免得把光标所在段落劈成两半。
 */
function MarkdownPastePlugin() {
  const [editor] = useLexicalComposerContext();
  useEffect(
    () =>
      editor.registerCommand<PasteCommandType>(
        PASTE_COMMAND,
        (event) => {
          // PASTE_COMMAND 也可能由键盘/输入事件触发，只有真正的剪贴板事件
          // 才有 clipboardData；其余交回 Lexical 默认粘贴。
          if (!("clipboardData" in event) || !event.clipboardData) return false;
          const text = event.clipboardData.getData("text/plain");
          if (!isMarkdownPaste(text)) return false;
          editor.update(() => {
            let sel = $getSelection();
            // 编辑器尚未聚焦时没有选区（程序化粘贴、刚挂载），
            // 落个光标到末尾再插，不能默默把内容丢掉。
            if (!$isRangeSelection(sel)) {
              $getRoot().selectEnd();
              sel = $getSelection();
            }
            if (!$isRangeSelection(sel)) return;
            const nodes = $generateNodesFromMarkdownString(
              text,
              TRANSFORMERS,
              true,
            );
            if (nodes.length === 1 && $isParagraphNode(nodes[0])) {
              sel.insertNodes(nodes[0].getChildren());
            } else {
              sel.insertNodes(nodes);
            }
          });
          return true;
        },
        MARKDOWN_PASTE_PRIORITY,
      ),
    [editor],
  );
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
  // 占位层必须与 contentEditable 的首行文本盒完全重合：同样的 py-0.5 与
  // leading-6，top 从 0 起。此前用 top-2（8px）而首行从 py-0.5（2px）起，
  // 浏览器光标于是比占位文字高出一截，看起来像竖杠悬在提示文字上方。
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
              $importMarkdown(initialValue);
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
            <div className="pointer-events-none absolute left-0 top-0 py-0.5 text-base leading-6 text-subtle">
              {placeholder}
            </div>
          }
          ErrorBoundary={LexicalErrorBoundary}
        />
        <HistoryPlugin />
        <MarkdownShortcutPlugin transformers={TRANSFORMERS} />
        <MarkdownPastePlugin />
        <OnChangePlugin
          ignoreSelectionChange
          onChange={(state, editor, tags) => {
            if (tags.has(PROGRAMMATIC_TAG)) {
              onChange(
                {
                  line: "",
                  caret: 0,
                  markdown: editorMarkdown(editor),
                  indentable: false,
                },
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
