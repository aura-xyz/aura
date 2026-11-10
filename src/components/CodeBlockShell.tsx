import { memo, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import CopyButton from "./CopyButton";
import { countLines, foldPreview, shouldFold } from "../lib/codeBlock";
import { langLabel } from "../lib/langLabels";

/**
 * 代码块外壳：语言标签、复制按钮、长代码折叠。
 *
 * 折叠是**默认**行为：超过 20 行的代码会把对话流撑得很长，
 * 让人翻不到后面的内容。折叠后留几行预览认得出是什么代码，
 * 想看再展开。
 */
const CodeBlockShell = memo(function CodeBlockShell({
  lang,
  code,
  children,
}: {
  lang: string | null;
  code: string;
  children: ReactNode;
}) {
  const foldable = shouldFold(code);
  const [expanded, setExpanded] = useState(false);
  const open = !foldable || expanded;

  return (
    <div className="md-code" data-ctx-codeblock={code}>
      {/* 32px 工具条带：语言标签常驻在左，折叠与复制固定在右。
          此前两者都是绝对定位浮在代码上，长代码滚动时会盖住内容。 */}
      <div className="md-code-bar">
        <span className="md-code-lang">{lang ? langLabel(lang) : "纯文本"}</span>
        <div className="md-code-tools">
          {foldable && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              aria-expanded={expanded}
              aria-label={expanded ? "折叠代码" : "展开代码"}
              className="md-code-fold"
            >
              {expanded ? (
                <ChevronDown size={12} className="shrink-0" />
              ) : (
                <ChevronRight size={12} className="shrink-0" />
              )}
              <span>{expanded ? "折叠" : `展开全部 ${countLines(code)} 行`}</span>
            </button>
          )}
          <CopyButton text={code} className="md-code-copy" label="复制代码" />
        </div>
      </div>
      {open ? (
        <pre>{children}</pre>
      ) : (
        <pre className="md-code-collapsed">
          {foldPreview(code)}
          {"\n…"}
        </pre>
      )}
    </div>
  );
});

/**
 * 普通浅比较即可，不做「忽略 children」的自定义比较：
 * 未闭合代码块降级成纯文本后，围栏闭合时 `code` 不变但 children 会变成
 * 带 hljs span 的高亮树；若按 code 强行跳过渲染，高亮就永远补不上了。
 * 真正的「冻结」在上游 MarkdownSegment（片段文本不变则整棵子树不重渲染），
 * 这里只拦住父级无关状态变化时连带动到代码块。
 */
export default CodeBlockShell;
