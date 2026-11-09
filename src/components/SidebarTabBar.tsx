/**
 * 右栏标签栏（v0.8.0）。
 *
 * 交互按 WAI-ARIA 的 tabs 模式做：
 * - `role="tablist"` / `role="tab"` + `aria-selected`
 * - 左右方向键在标签间**循环**移动，Home/End 跳到首尾
 * - 中键关闭（浏览器的老习惯，用户不用学）
 * - 关闭按钮常驻可见，不靠 hover——窄右栏里 hover 才出现的 × 太难点
 *
 * 溢出时横向滚动，滚动容器上不画滚动条。
 */
import { useRef, useState, type ReactNode } from "react";
import {
  Folder,
  Gauge,
  Globe,
  LayoutGrid,
  ListTodo,
  Plus,
  Terminal as TerminalIcon,
  X,
  type LucideIcon,
} from "lucide-react";
import AnchoredMenu from "./AnchoredMenu";
import ContextMenu, { type MenuState } from "./ContextMenu";
import type { SidebarTab, SidebarTabKind } from "../lib/sidebarTabs";

/** 标签种类 → 图标。图标由种类决定，不进标签数据（数据只管身份与标题）。 */
const KIND_ICONS: Record<SidebarTabKind, LucideIcon> = {
  start: LayoutGrid,
  files: Folder,
  web: Globe,
  terminal: TerminalIcon,
  todo: ListTodo,
  usage: Gauge,
};

/** 「+」菜单里可以新建的种类。 */
const NEWABLE: { kind: SidebarTabKind; label: string }[] = [
  { kind: "terminal", label: "终端" },
  { kind: "files", label: "工作区文件" },
  { kind: "web", label: "网页" },
  { kind: "todo", label: "任务清单" },
  { kind: "usage", label: "用量统计" },
];

interface Props {
  tabs: SidebarTab[];
  activeId: string;
  /** 至少保留一个标签时为 false */
  canClose: (tabId: string) => boolean;
  onActivate: (tabId: string) => void;
  onClose: (tabId: string) => void;
  onNew: (kind: SidebarTabKind) => void;
  /** 标签栏右侧的附加控件（全屏 / 关闭面板） */
  trailing?: ReactNode;
}

export function SidebarTabBar({
  tabs,
  activeId,
  canClose,
  onActivate,
  onClose,
  onNew,
  trailing,
}: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  /** 标签右键菜单（v0.8.1）：关掉这一串标签比一个个点 × 快得多。 */
  const [tabMenu, setTabMenu] = useState<MenuState | null>(null);
  const addAnchor = useRef<HTMLButtonElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);

  /** 方向键在标签间循环移动。 */
  function moveFocus(key: string, current: string): string | undefined {
    if (tabs.length === 0) return undefined;
    const index = tabs.findIndex((tab) => tab.id === current);
    const at = index < 0 ? 0 : index;
    switch (key) {
      case "ArrowLeft":
        return tabs[(at - 1 + tabs.length) % tabs.length].id;
      case "ArrowRight":
        return tabs[(at + 1) % tabs.length].id;
      case "Home":
        return tabs[0].id;
      case "End":
        return tabs[tabs.length - 1].id;
      default:
        return undefined;
    }
  }

  function focusTab(tabId: string) {
    const el = stripRef.current?.querySelector<HTMLElement>(
      `[data-tab-id="${tabId}"]`,
    );
    el?.focus();
  }

  return (
    <div className="flex shrink-0 items-center gap-1 border-b border-line px-2 py-1.5">
      <div
        ref={stripRef}
        role="tablist"
        aria-label="侧栏标签"
        className="scrollbar-hidden flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto"
      >
        {tabs.map((tab) => {
          const Icon = KIND_ICONS[tab.kind] ?? LayoutGrid;
          const active = tab.id === activeId;
          const closable = canClose(tab.id);
          return (
            <div
              key={tab.id}
              role="tab"
              tabIndex={active ? 0 : -1}
              aria-selected={active}
              data-tab-id={tab.id}
              title={tab.title}
              onClick={() => onActivate(tab.id)}
              onContextMenu={(e) => {
                e.preventDefault();
                setTabMenu({
                  x: e.clientX,
                  y: e.clientY,
                  items: [
                    ...(closable
                      ? [
                          {
                            label: "关闭此标签",
                            onClick: () => onClose(tab.id),
                          },
                        ]
                      : []),
                    {
                      label: "关闭其它标签",
                      onClick: () => {
                        for (const other of tabs) {
                          if (other.id !== tab.id && canClose(other.id)) {
                            onClose(other.id);
                          }
                        }
                      },
                    },
                    {
                      label: "关闭全部标签",
                      danger: true,
                      onClick: () => {
                        for (const other of tabs) {
                          if (canClose(other.id)) onClose(other.id);
                        }
                      },
                    },
                    {
                      label: "复制标题",
                      onClick: () => {
                        void navigator.clipboard?.writeText(tab.title).catch(() => {});
                      },
                    },
                  ],
                });
              }}
              onKeyDown={(e) => {
                if (e.target !== e.currentTarget) return;
                const next = moveFocus(e.key, tab.id);
                if (next !== undefined) {
                  e.preventDefault();
                  focusTab(next);
                  return;
                }
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onActivate(tab.id);
                }
              }}
              onAuxClick={(e) => {
                // 中键关闭；另一个键还按着时不要关
                if (e.button !== 1) return;
                e.preventDefault();
                if (closable && e.buttons === 0) onClose(tab.id);
              }}
              className={`group flex shrink-0 items-center gap-1 rounded-t-md border-b-2 px-2 py-1 text-[11px] transition-colors ${
                active
                  ? "border-brand text-foreground"
                  : "border-transparent text-subtle hover:text-foreground"
              }`}
            >
              <Icon size={12} aria-hidden className="shrink-0" />
              <span className="max-w-[9rem] truncate">{tab.title}</span>
              {closable && (
                <button
                  type="button"
                  aria-label={`关闭 ${tab.title}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onClose(tab.id);
                  }}
                  className="shrink-0 rounded p-0.5 text-subtle opacity-70 transition-opacity hover:bg-bubble hover:text-foreground hover:opacity-100"
                >
                  <X size={11} aria-hidden />
                </button>
              )}
            </div>
          );
        })}
      </div>

      <button
        type="button"
        ref={addAnchor}
        aria-label="新建标签"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen((v) => !v)}
        className="shrink-0 rounded-tag p-1 text-subtle transition-colors hover:bg-bubble hover:text-foreground"
      >
        <Plus size={13} aria-hidden />
      </button>

      {trailing}

      <AnchoredMenu
        open={menuOpen}
        anchorRef={addAnchor}
        onClose={() => setMenuOpen(false)}
      >
        {NEWABLE.map((item) => (
          <button
            key={item.kind}
            type="button"
            role="menuitem"
            onClick={() => {
              setMenuOpen(false);
              onNew(item.kind);
            }}
            className="flex w-full items-center px-3 py-1.5 text-left text-[12px] text-foreground transition-colors hover:bg-bubble"
          >
            {item.label}
          </button>
        ))}
      </AnchoredMenu>
      <ContextMenu state={tabMenu} onClose={() => setTabMenu(null)} />
    </div>
  );
}

export default SidebarTabBar;
