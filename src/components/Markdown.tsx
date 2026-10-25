import { memo, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { common } from "lowlight";
// common 集之外补充的语言。highlight.js 不随包发布这些子模块的类型，
// 声明在 src/vite-env.d.ts。注意两点：
// - TOML 没有独立语法文件，highlight.js 用 ini 语法覆盖（ini 的别名含
//   toml，注册 ini 后 ```toml 块即可高亮，已实测产出 hljs-attr 等 token）；
// - zig 是第三方插件，highlight.js 未内置，不纳入。
import ini from "highlight.js/lib/languages/ini";
import dockerfile from "highlight.js/lib/languages/dockerfile";
import powershell from "highlight.js/lib/languages/powershell";
import nginx from "highlight.js/lib/languages/nginx";
import protobuf from "highlight.js/lib/languages/protobuf";
import http from "highlight.js/lib/languages/http";
import { openUrl } from "@tauri-apps/plugin-opener";
import "katex/dist/katex.min.css";

interface Props {
  content: string;
}

/** 绝对 URL（含 http/https）才拦截外跳；相对链接与锚点交给默认行为 */
function isExternal(href: string): boolean {
  return /^https?:\/\//i.test(href);
}

/**
 * 语言标签显示名。模型输出的语言标识种类很多，只映射常见的，
 * 其余直接回退到标识本身（`tsx`、`sh` 这类反而比猜一个中文名更准确）。
 */
const LANG_LABELS: Record<string, string> = {
  bash: "Bash",
  c: "C",
  cpp: "C++",
  cs: "C#",
  css: "CSS",
  diff: "Diff",
  go: "Go",
  graphql: "GraphQL",
  html: "HTML",
  ini: "INI",
  java: "Java",
  javascript: "JavaScript",
  json: "JSON",
  jsx: "JSX",
  kotlin: "Kotlin",
  lua: "Lua",
  markdown: "Markdown",
  php: "PHP",
  python: "Python",
  py: "Python",
  rb: "Ruby",
  rs: "Rust",
  rust: "Rust",
  scss: "SCSS",
  sh: "Shell",
  shell: "Shell",
  sql: "SQL",
  swift: "Swift",
  toml: "TOML",
  ts: "TypeScript",
  tsx: "TSX",
  typescript: "TypeScript",
  vue: "Vue",
  xml: "XML",
  yaml: "YAML",
  yml: "YAML",
  zig: "Zig",
};

function langLabel(raw: string): string {
  const key = raw.toLowerCase();
  return LANG_LABELS[key] ?? raw;
}

// 这三项必须是模块级常量。在组件体内写字面量会每次 render 都造出新的
// 数组/对象，让 React.memo 的浅比较恒不相等——memo 形同虚设，
// 而 react-markdown 的解析（remark 词法分析 + 高亮 + KaTeX）并不便宜。
// 长对话里每个历史 block 都挂着一个 Markdown，全量重解析会拖垮流式渲染。
const REMARK_PLUGINS = [remarkGfm, remarkMath];
// languages 选项是**替换**而非追加（rehype-highlight: settings.languages || common），
// 因此必须显式摊开 common 再补额外语言——只传新增项会让 bash/rust/python 等
// 全部失去高亮。补的语言：ini（覆盖 TOML）、dockerfile、powershell、
// nginx、protobuf、http。
//
// 插件+选项必须写成**元组**：裸数组字面量会被推断成 `(Plugin|对象)[]`，
// 赋给 react-markdown 的 PluggableList 时报「position 0 不匹配」，
// 所以这里显式标注元组类型。
const HIGHLIGHT_PLUGIN: [typeof rehypeHighlight, Parameters<typeof rehypeHighlight>[0]] = [
  rehypeHighlight,
  {
    languages: {
      ...common,
      ini,
      dockerfile,
      powershell,
      nginx,
      protobuf,
      http,
    },
  },
];
const REHYPE_PLUGINS = [rehypeKatex, HIGHLIGHT_PLUGIN];

/**
 * react-markdown 没有 `isBlock` 参数，只能靠 children 结构判断：
 * 代码块是 `<pre><code>…</code></pre>`，行内代码是裸 `<code>`。
 */
function pickLang(children: React.ReactNode): string | null {
  const child = Array.isArray(children) ? children[0] : children;
  if (!child || typeof child !== "object" || !("props" in child)) return null;
  const cls = (child as { props?: { className?: string } }).props?.className;
  const m = /language-([\w+#-]+)/.exec(cls ?? "");
  return m ? m[1] : null;
}

/**
 * 从 `<pre>` 的 children 里取出纯代码文本，供右键「复制代码」使用。
 *
 * 高亮后结构是 `<code>` 下挂多个 span，纯靠 DOM 文本提取比重建高亮树可靠。
 */
function extractCodeText(children: React.ReactNode): string {
  const child = Array.isArray(children) ? children[0] : children;
  if (!child || typeof child !== "object" || !("props" in child)) return "";
  const props = (child as { props?: { children?: React.ReactNode } }).props;
  const inner = props?.children;
  if (typeof inner === "string") return inner;
  if (Array.isArray(inner)) return inner.map((c) => (typeof c === "string" ? c : "")).join("");
  return "";
}

const COMPONENTS = {
  a: ({ children, href }: { children?: React.ReactNode; href?: string }) => (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ),
  /** 代码块左上角标出语言；行内代码由 CSS 自行处理，不在此处介入 */
  pre: ({ children }: { children?: React.ReactNode }) => {
    const lang = pickLang(children);
    const code = extractCodeText(children);
    return (
      <div className="md-code" data-ctx-codeblock={code}>
        {lang && <span className="md-code-lang">{langLabel(lang)}</span>}
        <pre>{children}</pre>
      </div>
    );
  },
};

const Markdown = memo(function Markdown({ content }: Props) {
  /**
   * 模型输出里的链接一律用系统浏览器打开，绝不让 WebView 跟随导航。
   *
   * 否则 WebView 会跳到该页面，把整个 React 应用替换掉；而窗口是
   * `decorations: false`，连标题栏的关闭按钮都不存在，用户只能杀进程。
   */
  const handleClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const anchor = (e.target as HTMLElement).closest("a");
    if (!anchor) return;
    const href = anchor.getAttribute("href") ?? "";
    if (!isExternal(href)) return;
    e.preventDefault();
    void openUrl(href).catch(() => {
      /* 打开失败时静默，避免打断对话 */
    });
  }, []);

  return (
    <div className="md" onClick={handleClick}>
      <ReactMarkdown
        remarkPlugins={REMARK_PLUGINS}
        rehypePlugins={REHYPE_PLUGINS}
        components={COMPONENTS}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
});

export default Markdown;