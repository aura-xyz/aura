/**
 * 右侧文件浏览面板（v0.8.0）。
 *
 * 浏览工作区（及白名单目录）的目录树：点目录进入、点文件预览文本。
 * 访问范围由后端 `list_directory` / `read_file_text` 用工作区 + 白名单闸门判定，
 * 面板本身不做路径安全检查。
 */
import { useEffect, useState } from "react";
import {
  ChevronRight,
  File as FileIcon,
  FileCode2,
  FileJson,
  FileText,
  Folder,
  FolderOpen,
  Image as ImageIcon,
  RefreshCw,
  X,
} from "lucide-react";
import { listDirectory, readFileText, type DirEntry } from "../lib/api";
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
  }

  function goUp() {
    setStack((s) => (s.length > 1 ? s.slice(0, -1) : s));
  }

  async function openFile(entry: DirEntry) {
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

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* 面包屑 / 返回 */}
      <div className="flex shrink-0 items-center gap-1 overflow-x-auto px-2 py-1 text-[11px] text-subtle">
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
          <div className="flex shrink-0 items-center gap-1 border-y border-line px-2 py-1 text-[11px]">
            <KindIcon kind={fileKindOf(preview.name)} size={12} />
            <span className="min-w-0 flex-1 truncate" title={preview.name}>
              {preview.name}
            </span>
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
          <pre className="scrollbar-thin min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words px-3 py-2 font-mono text-[12px] leading-relaxed text-foreground">
            {preview.content}
          </pre>
        </div>
      ) : (
        <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-1 pb-2">
          {error && (
            <p className="px-2 py-2 text-[11px] text-danger">{error}</p>
          )}
          {!error && !loading && entries.length === 0 && (
            <p className="px-2 py-2 text-[11px] text-subtle">空目录</p>
          )}
          {sortEntries(entries).map((entry) => (
            <button
              key={entry.path}
              type="button"
              onClick={() => (entry.is_dir ? enterDir(entry) : void openFile(entry))}
              title={entry.path}
              className="flex w-full items-center gap-2 rounded-tag px-2 py-1 text-left text-[12px] text-foreground transition-colors hover:bg-bubble"
            >
              {entry.is_dir ? (
                <Folder size={13} className="shrink-0 text-brand" />
              ) : (
                <KindIcon kind={fileKindOf(entry.name)} />
              )}
              <span className="min-w-0 flex-1 truncate">{entry.name}</span>
              {!entry.is_dir && (
                <span className="shrink-0 text-[10px] text-subtle tabular-nums">
                  {formatSize(entry.size)}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
