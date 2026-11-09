/**
 * 侧栏开始页（v0.8.0）。
 *
 * 右栏不再按「网页 / 文件」分区后，第一次打开是空的——总得给用户一个
 * 落点。开始页就是一列入口卡片：工作区文件 / 新建终端 / 浏览器 / 更多工具。
 *
 * 卡片里的 shell 下拉是**懒加载**的：菜单展开时才去问后端「这台机器上
 * 有哪些 shell」，没展开就不问——枚举要扫 PATH，不该在每次渲染时都做一遍。
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Check,
  ChevronDown,
  Folder,
  FolderOpen,
  Globe,
  LayoutGrid,
  Terminal as TerminalIcon,
} from "lucide-react";
import AnchoredMenu from "./AnchoredMenu";
import { getWorkspace } from "../lib/api";
import { listShells, preferredShell, rememberShell, type ShellProfile } from "../lib/terminal";

interface Props {
  /** 打开工作区文件标签 */
  onOpenFiles: () => void;
  /** 打开网页标签 */
  onOpenWeb: () => void;
  /** 打开终端标签；给了 shellPath 就用指定的 shell */
  onOpenTerminal: (shellPath?: string) => void;
  /** 打开更多工具（任务 / 用量） */
  onOpenMore: (kind: "todo" | "usage") => void;
}

interface CardProps {
  icon: ReactNode;
  title: string;
  description: string;
  shortcut?: string;
  onPick: () => void;
  /** 标题右侧的附加控件（终端卡片的 shell 下拉） */
  aside?: ReactNode;
}

/**
 * 入口卡片：**整卡可点**（v0.8.1）。
 *
 * 之前只有标题文字是按钮，卡片右侧一大片空白点了没反应——用户的直觉是
 * 「这张卡」能点。所以把点击放到外层容器上，内部的 shell/更多 下拉自己
 * `stopPropagation`，避免点下拉时顺手把标签也切换了。
 */
function GuideCard({ icon, title, description, shortcut, onPick, aside }: CardProps) {
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`打开${title}`}
      onClick={onPick}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onPick();
        }
      }}
      className="flex w-full cursor-pointer items-center gap-3 rounded-card border border-line bg-surface px-3 py-2.5 text-left transition-colors hover:border-brand hover:bg-brand/[0.03] focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand/40"
    >
      <span
        aria-hidden
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand/10 text-brand"
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1">
          <span className="truncate text-[13px] font-medium text-foreground">
            {title}
          </span>
          {aside}
        </span>
        <span className="mt-0.5 block truncate text-[11px] text-subtle">
          {description}
        </span>
      </span>
      {shortcut && (
        <kbd className="shrink-0 rounded border border-line px-1.5 py-0.5 text-[10px] text-subtle">
          {shortcut}
        </kbd>
      )}
    </div>
  );
}

export function SidebarStartPage({
  onOpenFiles,
  onOpenWeb,
  onOpenTerminal,
  onOpenMore,
}: Props) {
  const [workspace, setWorkspace] = useState("");
  const [shellOpen, setShellOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [shells, setShells] = useState<ShellProfile[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const shellAnchor = useRef<HTMLButtonElement>(null);
  const moreAnchor = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setSelected(preferredShell());
    // 开始页得说清「这是哪个工作区」：同一台机器上可能有好几个项目，
    // 打开文件前不知道自己在哪一层是很常见的不安。
    void getWorkspace()
      .then((path) => setWorkspace(path))
      .catch(() => {});
  }, []);

  // 菜单展开时才去枚举 shell：扫 PATH 不该在每次渲染时都做
  useEffect(() => {
    if (!shellOpen || shells !== null) return;
    let cancelled = false;
    listShells()
      .then((list) => {
        if (!cancelled) setShells(list);
      })
      .catch(() => {
        if (!cancelled) setShells([]);
      });
    return () => {
      cancelled = true;
    };
  }, [shellOpen, shells]);

  function pickShell(shell: ShellProfile) {
    rememberShell(shell.path);
    setSelected(shell.path);
    setShellOpen(false);
    onOpenTerminal(shell.path);
  }

  const currentShell = shells?.find((s) => s.path === selected);

  return (
    <div className="scrollbar-thin flex min-h-0 flex-1 flex-col overflow-y-auto px-3 py-6">
      {/* 工作区抬头：开始页最大的信息缺口是「我现在在哪个项目里」 */}
      {workspace && (
        <div className="mx-auto mb-3 flex w-full max-w-[380px] items-center gap-1.5 rounded-card border border-line bg-surface px-3 py-2">
          <FolderOpen size={13} className="shrink-0 text-brand" aria-hidden />
          <span className="min-w-0 flex-1 truncate text-[11px] text-subtle" title={workspace}>
            {workspace}
          </span>
        </div>
      )}
      <div className="mx-auto flex w-full max-w-[380px] flex-col gap-2">
        <GuideCard
          icon={<Folder size={16} aria-hidden />}
          title="工作区文件"
          description="浏览会话工作区的文件"
          shortcut="Ctrl + P"
          onPick={onOpenFiles}
        />

        <GuideCard
          icon={<TerminalIcon size={16} aria-hidden />}
          title="新建终端"
          description="在会话工作区运行命令"
          shortcut="Ctrl + `"
          onPick={() => onOpenTerminal(selected ?? undefined)}
          aside={
            <button
              type="button"
              ref={shellAnchor}
              aria-label="选择终端 shell"
              aria-haspopup="menu"
              aria-expanded={shellOpen}
              onClick={(e) => {
                // 卡片整体可点，下拉自己处理，别把「新建终端」也触发掉
                e.stopPropagation();
                setShellOpen((v) => !v);
              }}
              className="shrink-0 rounded p-0.5 text-subtle transition-colors hover:bg-bubble hover:text-foreground"
            >
              <ChevronDown size={12} aria-hidden />
            </button>
          }
        />

        <GuideCard
          icon={<Globe size={16} aria-hidden />}
          title="浏览器"
          description="浏览网页"
          shortcut="Ctrl + T"
          onPick={onOpenWeb}
        />

        <GuideCard
          icon={<LayoutGrid size={16} aria-hidden />}
          title="更多工具"
          description="任务清单、用量统计"
          onPick={() => onOpenMore("todo")}
          aside={
            <button
              type="button"
              ref={moreAnchor}
              aria-label="展开更多工具"
              aria-haspopup="menu"
              aria-expanded={moreOpen}
              onClick={(e) => {
                e.stopPropagation();
                setMoreOpen((v) => !v);
              }}
              className="shrink-0 rounded p-0.5 text-subtle transition-colors hover:bg-bubble hover:text-foreground"
            >
              <ChevronDown size={12} aria-hidden />
            </button>
          }
        />
      </div>

      <AnchoredMenu
        open={shellOpen}
        anchorRef={shellAnchor}
        onClose={() => setShellOpen(false)}
      >
        {shells === null && (
          <p className="px-3 py-1.5 text-[11px] text-subtle">正在查找可用的 shell…</p>
        )}
        {shells !== null && shells.length === 0 && (
          <p className="px-3 py-1.5 text-[11px] text-subtle">
            没有找到可用的 shell
          </p>
        )}
        {shells?.map((shell) => (
          <button
            key={shell.path}
            type="button"
            role="menuitemradio"
            aria-checked={shell.path === selected}
            onClick={() => pickShell(shell)}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-foreground transition-colors hover:bg-bubble"
          >
            <span className="min-w-0 flex-1 truncate">{shell.name}</span>
            {shell.path === selected && (
              <Check size={12} aria-hidden className="shrink-0 text-brand" />
            )}
          </button>
        ))}
      </AnchoredMenu>

      <AnchoredMenu
        open={moreOpen}
        anchorRef={moreAnchor}
        onClose={() => setMoreOpen(false)}
      >
        <button
          type="button"
          role="menuitem"
          onClick={() => {
            setMoreOpen(false);
            onOpenMore("todo");
          }}
          className="flex w-full items-center px-3 py-1.5 text-left text-[12px] text-foreground transition-colors hover:bg-bubble"
        >
          任务清单
        </button>
        <button
          type="button"
          role="menuitem"
          onClick={() => {
            setMoreOpen(false);
            onOpenMore("usage");
          }}
          className="flex w-full items-center px-3 py-1.5 text-left text-[12px] text-foreground transition-colors hover:bg-bubble"
        >
          用量统计
        </button>
      </AnchoredMenu>

      {currentShell && (
        <p className="mx-auto mt-3 w-full max-w-[380px] truncate text-center text-[10px] text-subtle">
          终端默认使用 {currentShell.name}
        </p>
      )}
    </div>
  );
}

export default SidebarStartPage;
