import { useState, type ReactNode } from "react";
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
export default function CodeBlockShell({
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
      {lang && <span className="md-code-lang">{langLabel(lang)}</span>}
      <CopyButton text={code} className="md-code-copy" label="复制代码" />
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
}
