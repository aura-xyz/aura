/**
 * 右侧文件浏览面板（v0.8.0）。
 *
 * 两种浏览形态可切换：
 *  - 「路径」模式：面包屑下钻，点目录进入、点文件预览文本（沿用早期实现）。
 *  - 「树形」模式：目录树，维护 expanded 集合，点开文件夹才懒加载子目录。
 *
 * 预览分流：Markdown 复用对话区渲染器；代码走带行号的等宽通道；图片走
 * asset protocol（`asset://`，C53 已把工作区与白名单目录注册进协议 scope）；
 * 其余一律纯文本。访问范围由后端 `list_directory` / `read_file_text` 用
 * 工作区 + 白名单闸门判定，面板本身不做路径安全检查。
 */
import { useEffect, useState } from "react";
import {
  Check,
  ChevronDown,
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
import { assetUrl } from "../lib/assetUrl";
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

interface PreviewState {
  name: string;
  content: string;
  /** 图片走 asset protocol 时的绝对路径；非图片为 undefined */
  absolute_path?: string;
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
  // 浏览形态：树形 / 路径（面包屑下钻）。默认沿用旧的下钻体验。
  const [mode, setMode] = useState<"tree" | "breadcrumb">("breadcrumb");

  // —— 路径模式：导航栈，首项永远是工作区根 ——
  const [stack, setStack] = useState<Crumb[]>([{ path: "/", name: "工作区" }]);

  // —— 树形模式：展开集合 + 已加载的子节点 + 加载中的节点 ——
  const [treeExpanded, setTreeExpanded] = useState<Set<string>>(new Set());
  const [treeChildren, setTreeChildren] = useState<Record<string, DirEntry[]>>({});
  const [treeLoading, setTreeLoading] = useState<Set<string>>(new Set());

  const [entries, setEntries] = useState<DirEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewState | null>(null);
  /** 目录内筛选：文件多起来之后，靠滚动找文件不如直接打字。 */
  const [query, setQuery] = useState("");
  /** 预览是否自动换行：代码默认不换行（保留对齐），散文默认换行。 */
  const [wrap, setWrap] = useState(true);
  const [copied, setCopied] = useState(false);
  /** 图片经 asset protocol 加载失败时的降级提示。 */
  const [imgFailed, setImgFailed] = useState(false);

  const current = stack[stack.length - 1];

  // —— 路径模式：加载当前目录 ——
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

  // —— 树形模式：懒加载某个节点的子目录 ——
  async function loadTreeNode(nodePath: string) {
    setTreeLoading((s) => new Set(s).add(nodePath));
    try {
      const children = await listDirectory(sessionId, nodePath);
      setTreeChildren((c) => ({ ...c, [nodePath]: children }));
    } catch {
      setTreeChildren((c) => ({ ...c, [nodePath]: [] }));
    } finally {
      setTreeLoading((s) => {
        const n = new Set(s);
        n.delete(nodePath);
        return n;
      });
    }
  }

  useEffect(() => {
    if (mode === "breadcrumb") {
      void load(current.path);
      setPreview(null);
    } else {
      void loadTreeNode("/");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, mode, current.path]);

  // —— 路径模式：导航 ——
  function enterDir(entry: DirEntry) {
    setStack((s) => [...s, { path: entry.path, name: entry.name }]);
    setQuery("");
  }
  function goUp() {
    setStack((s) => (s.length > 1 ? s.slice(0, -1) : s));
  }

  // —— 树形模式：展开 / 收起（点开才加载） ——
  function toggleTreeNode(entry: DirEntry) {
    setTreeExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(entry.path)) {
        next.delete(entry.path);
      } else {
        next.add(entry.path);
        if (!treeChildren[entry.path]) void loadTreeNode(entry.path);
      }
      return next;
    });
  }

  async function openFile(entry: DirEntry) {
    // 图片走 asset protocol：直接拿绝对路径拼 asset://，不读文本。
    const kind = fileKindOf(entry.name);
    setWrap(kind === "markdown" || kind === "text");
    setCopied(false);
    setImgFailed(false);
    if (kind === "image") {
      if (entry.absolute_path) {
        setPreview({ name: entry.name, content: "", absolute_path: entry.absolute_path });
      } else {
        setPreview({
          name: entry.name,
          content: "图片预览需要后端返回绝对路径（请更新到含 C54 的后端）",
        });
      }
      return;
    }
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
    const text =
      previewKind === "image" ? (preview.absolute_path ?? "") : preview.content;
    if (!text) return;
    void navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => {});
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* 形态切换 + 刷新 */}
      <div className="flex shrink-0 items-center gap-1 border-b border-line px-2 py-1">
        <div className="flex items-center rounded-tag bg-surface-sunken p-0.5 text-[11px]">
          <button
            type="button"
            onClick={() => setMode("tree")}
            aria-pressed={mode === "tree"}
            className={`rounded px-2 py-0.5 transition-colors ${
              mode === "tree" ? "bg-surface text-foreground" : "text-subtle hover:text-foreground"
            }`}
          >
            树形
          </button>
          <button
            type="button"
            onClick={() => setMode("breadcrumb")}
            aria-pressed={mode === "breadcrumb"}
            className={`rounded px-2 py-0.5 transition-colors ${
              mode === "breadcrumb"
                ? "bg-surface text-foreground"
                : "text-subtle hover:text-foreground"
            }`}
          >
            路径
          </button>
        </div>
        <button
          type="button"
          onClick={() => (mode === "tree" ? void loadTreeNode("/") : void load(current.path))}
          aria-label="刷新"
          title="刷新"
          className="ml-auto shrink-0 rounded-tag p-1 hover:bg-bubble hover:text-foreground"
        >
          <RefreshCw size={12} className={mode === "tree" ? (treeLoading.has("/") ? "animate-spin" : "") : loading ? "animate-spin" : ""} />
        </button>
      </div>

      {/* 路径模式：面包屑导航 */}
      {mode === "breadcrumb" && (
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
        </div>
      )}

      {preview ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex shrink-0 items-center gap-1.5 border-b border-line bg-surface-sunken/60 px-2 py-1.5 text-[11px]">
            <KindIcon kind={previewKind} size={12} />
            <span className="min-w-0 flex-1 truncate font-medium text-foreground" title={preview.name}>
              {preview.name}
            </span>
            {previewKind !== "image" && (
              <span className="shrink-0 tabular-nums text-subtle">{lineCount} 行</span>
            )}
            {previewKind !== "markdown" && previewKind !== "image" && (
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
              {copied ? <Check size={12} className="text-success" /> : <Copy size={12} />}
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

          {previewKind === "image" && preview.absolute_path ? (
            imgFailed ? (
              <div className="scrollbar-thin min-h-0 flex-1 overflow-auto p-3 text-[11px] text-danger">
                图片加载失败：可能不在已授权目录内，或后端资产协议未启用。
              </div>
            ) : (
              <div className="scrollbar-thin flex min-h-0 flex-1 items-center justify-center overflow-auto bg-surface-sunken/40 p-3">
                <img
                  src={assetUrl(preview.absolute_path)}
                  alt={preview.name}
                  className="max-h-full max-w-full object-contain"
                  onError={() => setImgFailed(true)}
                />
              </div>
            )
          ) : previewKind === "markdown" ? (
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
      ) : mode === "tree" ? (
        <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-1 pb-2">
          {treeLoading.has("/") ? (
            <p className="px-2 py-2 text-[11px] text-subtle">加载中…</p>
          ) : treeChildren["/"] ? (
            sortEntries(treeChildren["/"]).map((entry) => (
              <TreeNode
                key={entry.path}
                entry={entry}
                depth={0}
                expanded={treeExpanded}
                childrenMap={treeChildren}
                loading={treeLoading}
                onToggle={toggleTreeNode}
                onOpen={openFile}
                onLoad={loadTreeNode}
              />
            ))
          ) : (
            <p className="px-2 py-2 text-[11px] text-subtle">空目录</p>
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
            {error && <p className="px-2 py-2 text-[11px] text-danger">{error}</p>}
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

/**
 * 树形节点：目录可展开（懒加载），文件点击预览。子树在父节点展开后递归渲染。
 */
function TreeNode({
  entry,
  depth,
  expanded,
  childrenMap,
  loading,
  onToggle,
  onOpen,
  onLoad,
}: {
  entry: DirEntry;
  depth: number;
  expanded: Set<string>;
  childrenMap: Record<string, DirEntry[]>;
  loading: Set<string>;
  onToggle: (e: DirEntry) => void;
  onOpen: (e: DirEntry) => void;
  onLoad: (path: string) => void;
}) {
  const isOpen = expanded.has(entry.path);
  const children = childrenMap[entry.path];
  const loadingNode = loading.has(entry.path);
  const kind = fileKindOf(entry.name);
  const indent = 8 + depth * 12;

  return (
    <div>
      <button
        type="button"
        onClick={() => (entry.is_dir ? onToggle(entry) : void onOpen(entry))}
        title={entry.path}
        className="flex w-full items-center gap-1.5 rounded-tag py-1 pr-2 text-left text-[12px] text-foreground transition-colors hover:bg-bubble"
        style={{ paddingLeft: indent }}
      >
        {entry.is_dir ? (
          isOpen ? (
            <ChevronDown size={12} className="shrink-0 text-subtle" />
          ) : (
            <ChevronRight size={12} className="shrink-0 text-subtle" />
          )
        ) : (
          <span className="w-3 shrink-0" />
        )}
        {entry.is_dir ? (
          isOpen ? (
            <FolderOpen size={13} className="shrink-0 text-brand" />
          ) : (
            <Folder size={13} className="shrink-0 text-brand" />
          )
        ) : (
          <KindIcon kind={kind} />
        )}
        <span className="min-w-0 flex-1 truncate">{entry.name}</span>
      </button>
      {entry.is_dir && isOpen && (
        <div>
          {loadingNode ? (
            <div className="py-1 text-[11px] text-subtle" style={{ paddingLeft: indent + 16 }}>
              加载中…
            </div>
          ) : children && children.length > 0 ? (
            sortEntries(children).map((c) => (
              <TreeNode
                key={c.path}
                entry={c}
                depth={depth + 1}
                expanded={expanded}
                childrenMap={childrenMap}
                loading={loading}
                onToggle={onToggle}
                onOpen={onOpen}
                onLoad={onLoad}
              />
            ))
          ) : (
            <div className="py-1 text-[11px] text-subtle" style={{ paddingLeft: indent + 16 }}>
              空目录
            </div>
          )}
        </div>
      )}
    </div>
  );
}
