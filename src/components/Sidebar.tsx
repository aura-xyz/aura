import {
  ChevronRight,
  PanelLeft,
  Settings,
  Trash2,
} from "lucide-react";
import OpenInMenu from "./OpenInMenu";
import { useEffect, useRef, useState } from "react";
import { useStore } from "../store";

const COLLAPSE_KEY = "aura-sidebar-collapsed";

// 折叠后宽内容淡出的等待时间，与宽度过渡同步，避免中间重排。
const COLLAPSE_SETTLE_MS = 150;

export type View = "chat" | "settings" | "skills" | "mcp" | "timeline";

/** 左侧导航区块：由外部注入，Sidebar 只负责渲染与折叠动画。 */
export interface NavBlock {
  id: string;
  label: string;
  /** lucide 图标组件 */
  icon: React.ComponentType<{ size?: number; className?: string }>;
  onClick: () => void;
  /** 点击后打开的右侧面板内容类型（可选，供右侧面板联动） */
  panel?: string;
}

interface Props {
  /** 当前视图，用于高亮导航项 */
  view: View;
  /** 顶部导航区块，由外部注入，默认见 App.tsx DEFAULT_NAV_BLOCKS */
  navBlocks: NavBlock[];
  /** 右侧面板当前内容 id（未打开时为 null），用于高亮面板类导航项 */
  activePanel?: string | null;
  onOpenSettings: () => void;
  /** 选中会话后回调，用于从设置/Skills/MCP 页切回对话视图 */
  onNavigate?: () => void;
  /** 展开态宽度，由 App 的三栏几何求解下发 */
  width?: number;
  /** 受控折叠态；不传则由组件自己用 localStorage 记忆 */
  collapsed?: boolean;
  /** 折叠按钮回调，传入后由外层统一管窄视口自动折叠 */
  onToggleCollapsed?: () => void;
}

function basename(p: string): string {
  const parts = p.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? p;
}

export default function Sidebar({
  view,
  navBlocks,
  activePanel = null,
  onOpenSettings,
  onNavigate,
  width,
  collapsed: controlledCollapsed,
  onToggleCollapsed,
}: Props) {
  const {
    workspaces,
    workspace,
    sessions,
    activeId,
    switchWorkspace,
    openSession,
    deleteSession,
    renamingId,
    cancelRename,
    renameSession,
  } = useStore();

  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [innerCollapsed, setInnerCollapsed] = useState(
    () => localStorage.getItem(COLLAPSE_KEY) === "1",
  );
  const collapsed = controlledCollapsed ?? innerCollapsed;

  // 折叠动画：内容先保持宽度淡出，宽度收窄后再切到 rail 布局。
  const [settled, setSettled] = useState(collapsed);
  const everWide = useRef(!collapsed);
  if (!collapsed) everWide.current = true;

  useEffect(() => {
    if (!collapsed) { setSettled(false); return }
    const timer = window.setTimeout(() => { setSettled(true) }, COLLAPSE_SETTLE_MS)
    return () => { window.clearTimeout(timer) }
  }, [collapsed]);

  const wide = !collapsed || !settled

  // 工作区列表异步加载完毕后默认全部展开一次，之后完全交给用户控制。
  // 不再像以前那样跟随「当前工作区」自动展开：工作区已不再是切换目标，
  // 只是对话的归类方式，把所有组都露出来才能看见归类结果。
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current || workspaces.length === 0) return;
    seeded.current = true;
    setExpanded(new Set(workspaces));
  }, [workspaces]);

  function toggleCollapsed() {
    if (onToggleCollapsed) {
      onToggleCollapsed();
      return;
    }
    setInnerCollapsed((v) => {
      localStorage.setItem(COLLAPSE_KEY, v ? "0" : "1");
      return !v;
    });
  }

function toggleExpand(w: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(w)) next.delete(w);
      else next.add(w);
      return next;
    });
  }

  // 折叠时宽度收窄会由 overflow-hidden 裁掉内容。让文字靠 max-width +
  // opacity 过渡而不是直接 hidden，收窄过程中才不会拦腰截断。
  const label =
    "whitespace-nowrap transition-[max-width,opacity] duration-200 ease-in-out";
  const labelOff = "max-w-0 opacity-0";
  const labelOn = "max-w-40 opacity-100";

  return (
    // 展开态：与顶部标题栏同色连成一片（DSH 外壳），不要悬浮卡片；
    // 收起态：回到原来的四周留白 + 圆角 + 细边框 + 轻阴影。
    //
    // 高度：self-start + min-height 控制。展开态撑满内容区，
    // 折叠态收成内容高，设置按钮下方不再留白。
    // min-height 在「确定值 ↔ 0」之间可插值，配合宽度一起做 200ms 过渡；
    // max-height 同步限高，圆点很多时列表区内部滚动而不溢出窗口。
    <aside
      className={`flex shrink-0 flex-col self-start overflow-hidden transition-[width,min-height] duration-200 ease-in-out ${
        collapsed
          ? "m-2 max-h-[calc(100%-1rem)] w-14 min-h-0 rounded-card border border-line bg-surface shadow-sm"
          : "m-0 max-h-full min-h-full w-64 rounded-none border-0 bg-chrome"
      } ${!wide && everWide.current ? "railIn" : ""} ${collapsed && wide ? "fading" : ""}`}
      style={{
        width: collapsed ? (wide ? (width ?? 240) : undefined) : (width ?? undefined),
      }}
    >
      <header className="flex h-[49px] shrink-0 items-center gap-2 px-3">
        {/* 折叠态下 logo 即展开入口，不再 disabled，避免用户无法展开。 */}
        <button
          type="button"
          onClick={toggleCollapsed}
          aria-label="Aura"
          title="Aura"
          className="shrink-0 rounded-tag p-1.5 text-subtle transition-colors hover:bg-bubble hover:text-foreground"
        >
          <img src="/logo.png" alt="Aura" draggable={false} className="h-5 w-5" />
        </button>
        <span
          className={`${label} text-base font-semibold tracking-[-0.02em] ${
            collapsed ? labelOff : labelOn
          }`}
        >
          Aura
        </span>
        {!collapsed ? (
          <div className="ml-auto flex shrink-0 items-center gap-1">
            <OpenInMenu sessionId={activeId ?? ""} workspace={workspace ?? ""} />
            <button
              type="button"
              onClick={toggleCollapsed}
              aria-label="收起侧边栏"
              title="收起侧边栏"
              className="shrink-0 rounded-tag p-1 text-subtle transition-colors hover:bg-bubble hover:text-foreground"
            >
              <PanelLeft size={14} />
            </button>
          </div>
        ) : (
          everWide.current && (
            <button
              type="button"
              onClick={toggleCollapsed}
              aria-label="展开侧边栏"
              title="展开侧边栏"
              className="ml-auto shrink-0 rounded-tag p-1 text-subtle transition-colors hover:bg-bubble hover:text-foreground"
            >
              <PanelLeft size={14} />
            </button>
          )
        )}
      </header>

      {/* 顶部导航：新建对话 / Skills / MCP / 轨迹。平铺，不加卡片边框——
          折叠态下边框会在 56px 宽里挤成一条窄条，图标也就跟着偏了。

          pb-3 是刻意留的：此前 nav 与下方会话列表之间一点空隙都没有，
          「轨迹」的下边缘几乎贴着第一条会话，视觉上像挤在一起（实测反馈）。 */}
      <nav
        className={`shrink-0 px-3 pb-3 ${collapsed && wide ? "fading" : ""}`}
      >
        {navBlocks.map((block) => {
          const active = block.panel
            ? activePanel === block.panel
            : block.id !== "new" && view === block.id;
          return (
            <button
              key={block.id}
              type="button"
              onClick={block.onClick}
              aria-current={active ? "page" : undefined}
              title={collapsed ? block.label : undefined}
              className={`flex w-full items-center rounded-tag py-2 text-left text-sm transition-colors ${
                collapsed ? "justify-center gap-0 px-0" : "gap-2.5 px-2"
              } ${
                active
                  ? "bg-bubble font-medium text-foreground"
                  : "text-subtle hover:bg-bubble hover:text-foreground"
              }`}
            >
              <block.icon size={15} className="shrink-0" />
              <span className={`${label} ${collapsed ? labelOff : labelOn}`}>
                {block.label}
              </span>
            </button>
          );
        })}
      </nav>

      {/* 工作区列表。折叠态是圆点指示器、展开态是可折叠分组，
          两者结构不同构，只能各自渲染；宽度过渡期间被 overflow-hidden 裁切。
          折叠态不加 flex-1：圆点紧贴下方设置按钮，避免中段被撑出大片空白。 */}
      <div
        className={`scrollbar-hidden min-h-0 overflow-y-auto ${
          collapsed ? "pb-0" : "flex-1 pb-2"
        } ${collapsed && wide ? "fading" : ""}`}
      >
        {collapsed ? (
          <div className="px-2 py-1">
            {workspaces.map((w) => (
              <button
                key={w}
                type="button"
                onClick={() => {
                  switchWorkspace(w);
                  onNavigate?.();
                }}
                title={w}
                aria-label={w}
                className="mx-auto flex w-full items-center justify-center rounded-tag py-2 transition-colors hover:bg-bubble"
              >
                <span
                  className={`h-2 w-2 rounded-full ${
                    w === workspace ? "bg-brand" : "bg-line"
                  }`}
                />
              </button>
            ))}
          </div>
        ) : (
          <div className="px-3">
            {workspaces.map((w) => {
const isOpen = expanded.has(w);
   // 空对话是内存草稿，不进侧边栏：发过第一条消息才归类显示
          const wsSessions = sessions.filter(
      (s) => s.workspace === w && s.messages.length > 0,
      );
              const isCurrent = w === workspace;
              return (
                <section key={w} className="mb-0.5">
                  {/* 整行一个按钮。此前箭头与工作区名是两个按钮做同一件事，
                      可访问名相同、行为却要写两遍。 */}
                  <button
                    type="button"
                    data-ctx-workspace={w}
                    onClick={() => toggleExpand(w)}
                    aria-expanded={isOpen}
                    title={w}
                    className={`flex w-full min-w-0 items-center gap-2 rounded-tag py-1.5 pl-1 pr-2 text-left text-sm transition-colors ${
                      isCurrent ? "bg-bubble" : "hover:bg-bubble"
                    }`}
                  >
                    <ChevronRight
                      size={13}
                      className={`shrink-0 text-subtle transition-transform ${
                        isOpen ? "rotate-90" : ""
                      }`}
                    />
                    <span
                      className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                        isCurrent ? "bg-brand" : "bg-line"
                      }`}
                    />
                    <span
                      className={`truncate ${
                        isCurrent ? "font-medium" : "text-subtle"
                      }`}
                    >
                      {basename(w)}
                    </span>
                  </button>

                  {isOpen && (
                    <ul className="ml-5 mt-0.5 space-y-0.5">
                      {wsSessions.map((s) => (
                        <li key={s.id}>
                          <div
                            data-ctx-session={s.id}
                            className={`group flex items-center rounded-tag transition-colors ${
                              // 选中态用品牌蓝浅底 + 左侧品牌色竖线，与页签激活线同源
                              s.id === activeId
                                ? "bg-bubble-user font-medium text-foreground"
                                : "hover:bg-bubble"
                            }`}
                          >
                            {s.id === activeId && (
                              <span
                                aria-hidden="true"
                                className="ml-1 h-4 w-0.5 shrink-0 rounded-full bg-brand"
                              />
                            )}
                            {renamingId === s.id ? (
                              <input
                                autoFocus
                                defaultValue={s.title}
                                onFocus={(e) => e.target.select()}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") {
                                    renameSession(s.id, e.currentTarget.value);
                                    cancelRename();
                                  } else if (e.key === "Escape") {
                                    cancelRename();
                                  }
                                }}
                                onBlur={(e) => {
                                  renameSession(s.id, e.currentTarget.value);
                                  cancelRename();
                                }}
                                className="min-w-0 flex-1 rounded-lg border border-brand bg-surface px-2 py-1.5 text-sm text-foreground outline-none"
                              />
                            ) : (
                              <button
                                type="button"
                                onClick={() => {
                                  openSession(s.id);
                                  onNavigate?.();
                                }}
                                className="min-w-0 flex-1 truncate px-2 py-1.5 text-left text-sm"
                              >
                                {s.title}
                              </button>
                            )}
                            {renamingId !== s.id && (
                              <button
                                type="button"
                                onClick={() => deleteSession(s.id)}
                                aria-label="删除对话"
                                className="mr-1 rounded-tag p-1 text-subtle opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"
                              >
                                <Trash2 size={13} />
                              </button>
                            )}
                          </div>
                        </li>
                      ))}
                      {wsSessions.length === 0 && (
                        <li className="px-2 py-1.5 text-xs text-subtle">暂无对话</li>
                      )}
                    </ul>
                  )}
                </section>
              );
            })}
          </div>
        )}
      </div>

      {/* mt-auto：折叠时列表 DOM 瞬间从分组切换为圆点（短），若无自动
          外边距，设置按钮会立刻跳到圆点下方，而下边缘还在 min-height
          过渡中慢慢上升——表现为「先提按钮、再收边缘」。有了 mt-auto，
          过渡中产生的自由空间被它吸收，按钮钉在底边随下边缘一起上升；
          静态两态没有自由空间，表现与此前完全一致。 */}
      <footer className={`mt-auto shrink-0 px-3 pb-3 ${collapsed && wide ? "fading" : ""}`}>
        <button
          type="button"
          onClick={onOpenSettings}
          aria-current={view === "settings" ? "page" : undefined}
          className={`flex w-full items-center rounded-tag py-1.5 text-sm transition-colors hover:bg-bubble hover:text-foreground ${
            collapsed ? "justify-center gap-0 px-0" : "gap-2 px-2"
          } ${
            view === "settings"
              ? "bg-bubble font-medium text-foreground"
              : "text-subtle"
          }`}
        >
          <Settings size={14} className="shrink-0" />
          <span className={`${label} ${collapsed ? labelOff : labelOn}`}>设置</span>
        </button>
      </footer>
    </aside>
  );
}