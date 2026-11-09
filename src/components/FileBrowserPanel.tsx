/**
 * 右侧文件浏览面板（v0.8.0）。
 *
 * 浏览工作区（及白名单目录）的目录树：点目录进入、点文件预览文本。
 * 访问范围由后端 `list_directory` / `read_file_text` 用工作区 + 白名单闸门判定，
 * 面板本身不做路径安全检查。
 */
import { useEffect, useState } from "react";
import {
  Check,
  ChevronRight,
  Copy,
  File as FileIcon,
  FileCode2,
  FileJson,
  FileText,
  Folder,
  FolderOpen,
  Image as ImageIcon,
  RefreshCw,
  Search,
  WrapText,
  X,
} from "lucide-react";
import { listDirectory, readFileText, type DirEntry } from "../lib/api";
import Markdown from "./Markdown";
import {
  FILE_KIND_TINT,
  fileKindOf,
  sortEntries,
  type FileKind,
} from "../lib/fileIcon";

interface Props {
  /** 会话 id：后端据此定位该会话自己的工作区 */
  sessionId: string;
}

interface Crumb {
  path: string;
  name: string;
}

function formatSize(bytes: number): string {
  if (bytes <= 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** 档位 → 图标组件。目录不在此列，由调用方单独处理。 */
const KIND_ICON = {
  markdown: FileText,
  code: FileCode2,
  data: FileJson,
  image: ImageIcon,
  style: FileCode2,
  text: FileIcon,
} as const;

function KindIcon({ kind, size = 13 }: { kind: FileKind; size?: number }) {
  const Icon = KIND_ICON[kind];
  return <Icon size={size} className={`shrink-0 ${FILE_KIND_TINT[kind]}`} />;
}

export function FileBrowserPanel({ sessionId }: Props) {
  // 导航栈：首项永远是工作区根，进入子目录时压栈，返回时弹栈。
  const [stack, setStack] = useState<Crumb[]>([{ path: "/", name: "工作区" }]);
  const [entries, setEntries] = useState<DirEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ name: string; content: string } | null>(
    null,
  );
  /** 目录内筛选：文件多起来之后，靠滚动找文件不如直接打字。 */
  const [query, setQuery] = useState("");
  /** 预览是否自动换行：代码默认不换行（保留对齐），散文默认换行。 */
  const [wrap, setWrap] = useState(true);
  const [copied, setCopied] = useState(false);

  const current = stack[stack.length - 1];

  async function load(path: string) {
    setLoading(true);
    setError(null);
    try {
      setEntries(await listDirectory(sessionId, path));
    } catch (e) {
      setEntries([]);
      setError(typeof e === "string" ? e : "读取目录失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load(current.path);
    setPreview(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, current.path]);

  function enterDir(entry: DirEntry) {
    setStack((s) => [...s, { path: entry.path, name: entry.name }]);
    setQuery("");
  }

  function goUp() {
    setStack((s) => (s.length > 1 ? s.slice(0, -1) : s));
  }

  async function openFile(entry: DirEntry) {
    // 代码默认不换行：换行会破坏缩进对齐，代码就失去结构；
    // 散文（md/txt）默认换行，横着拖滚动条读文章是折磨。
    const kind = fileKindOf(entry.name);
    setWrap(kind === "markdown" || kind === "text");
    setCopied(false);
    try {
      const content = await readFileText(sessionId, entry.path);
      setPreview({ name: entry.name, content });
    } catch (e) {
      setPreview({
        name: entry.name,
        content: `无法预览：${typeof e === "string" ? e : String(e)}`,
      });
    }
  }

  const previewKind = preview ? fileKindOf(preview.name) : "text";
  const lineCount = preview ? preview.content.split("\n").length : 0;
  const visible = sortEntries(entries).filter((e) =>
    query.trim() ? e.name.toLowerCase().includes(query.trim().toLowerCase()) : true,
  );

  function copyPath() {
    if (!preview) return;
    void navigator.clipboard
      .writeText(preview.content)
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => {});
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* 面包屑 / 返回 */}
      <div className="flex shrink-0 items-center gap-1 border-b border-line px-2 py-1 text-[11px] text-subtle">
        {stack.length > 1 && (
          <button
            type="button"
            onClick={goUp}
            aria-label="返回上一级"
            title="返回上一级"
            className="shrink-0 rounded-tag p-1 hover:bg-bubble hover:text-foreground"
          >
            <FolderOpen size={13} />
          </button>
        )}
        <nav className="flex min-w-0 items-center gap-0.5" aria-label="路径">
          {stack.map((crumb, i) => (
            <span key={i} className="flex items-center gap-0.5">
              {i > 0 && <ChevronRight size={11} className="shrink-0" />}
              <button
                type="button"
                onClick={() => setStack((s) => s.slice(0, i + 1))}
                aria-current={i === stack.length - 1 ? "location" : undefined}
                className={`max-w-[10rem] truncate rounded px-1 hover:text-foreground ${
                  i === stack.length - 1 ? "font-medium text-foreground" : ""
                }`}
              >
                {crumb.name}
              </button>
            </span>
          ))}
        </nav>
        <button
          type="button"
          onClick={() => void load(current.path)}
          aria-label="刷新"
          title="刷新"
          className="ml-auto shrink-0 rounded-tag p-1 hover:bg-bubble hover:text-foreground"
        >
          <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
        </button>
      </div>

      {preview ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex shrink-0 items-center gap-1.5 border-b border-line bg-surface-sunken/60 px-2 py-1.5 text-[11px]">
            <KindIcon kind={previewKind} size={12} />
            <span className="min-w-0 flex-1 truncate font-medium text-foreground" title={preview.name}>
              {preview.name}
            </span>
            <span className="shrink-0 tabular-nums text-subtle">
              {lineCount} 行
            </span>
            {previewKind !== "markdown" && (
              <button
                type="button"
                onClick={() => setWrap((v) => !v)}
                aria-pressed={wrap}
                aria-label="自动换行"
                title={wrap ? "关闭自动换行" : "开启自动换行"}
                className={`shrink-0 rounded-tag p-1 transition-colors hover:bg-bubble hover:text-foreground ${
                  wrap ? "text-foreground" : "text-subtle"
                }`}
              >
                <WrapText size={12} />
              </button>
            )}
            <button
              type="button"
              onClick={copyPath}
              aria-label="复制内容"
              title="复制内容"
              className="shrink-0 rounded-tag p-1 text-subtle transition-colors hover:bg-bubble hover:text-foreground"
            >
              {copied ? (
                <Check size={12} className="text-success" />
              ) : (
                <Copy size={12} />
              )}
            </button>
            <button
              type="button"
              onClick={() => setPreview(null)}
              aria-label="关闭预览"
              title="关闭预览"
              className="shrink-0 rounded-tag p-1 text-subtle hover:bg-bubble hover:text-foreground"
            >
              <X size={12} />
            </button>
          </div>

          {previewKind === "markdown" ? (
            // Markdown 走对话区同一个渲染器：语法高亮、表格、公式与代码块
            // 都跟聊天里看到的一致，不用另做一套排版。
            <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-4 py-3">
              <Markdown content={preview.content} />
            </div>
          ) : wrap ? (
            <pre className="scrollbar-thin min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words px-3 py-2 font-mono text-[12px] leading-[1.65] text-foreground">
              {preview.content}
            </pre>
          ) : (
            // 不换行时给行号：读代码时「第几行」是最常被引用的坐标
            <div className="scrollbar-thin flex min-h-0 flex-1 overflow-auto font-mono text-[12px] leading-[1.65]">
              <div
                aria-hidden
                className="shrink-0 select-none border-r border-line bg-surface-sunken/50 px-2 py-2 text-right tabular-nums text-subtle"
              >
                {Array.from({ length: lineCount }, (_, i) => (
                  <div key={i}>{i + 1}</div>
                ))}
              </div>
              <pre className="min-w-0 flex-1 px-3 py-2 text-foreground">
                {preview.content}
              </pre>
            </div>
          )}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          {/* 目录内筛选：文件一多，滚动找文件比打字慢 */}
          <div className="flex shrink-0 items-center gap-1.5 px-2 pb-1 pt-1.5">
            <Search size={11} className="shrink-0 text-subtle" aria-hidden />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="筛选当前目录…"
              aria-label="筛选当前目录"
              spellCheck={false}
              className="min-w-0 flex-1 bg-transparent text-[11px] text-foreground outline-none placeholder:text-subtle"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label="清除筛选"
                className="shrink-0 rounded p-0.5 text-subtle hover:bg-bubble hover:text-foreground"
              >
                <X size={11} />
              </button>
            )}
          </div>
          <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-1 pb-2">
            {error && (
              <p className="px-2 py-2 text-[11px] text-danger">{error}</p>
            )}
            {!error && !loading && visible.length === 0 && (
              <p className="px-2 py-2 text-[11px] text-subtle">
                {query ? `没有匹配「${query}」的条目` : "空目录"}
              </p>
            )}
            {visible.map((entry) => (
              <button
                key={entry.path}
                type="button"
                onClick={() => (entry.is_dir ? enterDir(entry) : void openFile(entry))}
                title={entry.path}
                className="flex w-full items-center gap-2 rounded-tag px-2 py-1.5 text-left text-[12px] text-foreground transition-colors hover:bg-bubble"
              >
                {entry.is_dir ? (
                  <Folder size={13} className="shrink-0 text-brand" />
                ) : (
                  <KindIcon kind={fileKindOf(entry.name)} />
                )}
                <span className="min-w-0 flex-1 truncate">{entry.name}</span>
                {!entry.is_dir && (
                  <span className="shrink-0 text-[10px] tabular-nums text-subtle">
                    {formatSize(entry.size)}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
