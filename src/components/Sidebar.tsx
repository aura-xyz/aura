import {
  ChevronRight,
  PanelLeft,
  Plus,
  Settings,
  Trash2,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useStore } from "../store";
import ConfirmDialog from "./ConfirmDialog";

const COLLAPSE_KEY = "aura-sidebar-collapsed";

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
    newSession,
    openSession,
    deleteSession,
    renamingId,
    cancelRename,
    renameSession,
  } = useStore();

  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  // 删除是唯一不可撤销的动作，误触一下整个对话就没了（实测反馈）。
  // 点删除只记下目标，真正调 deleteSession 必须过二次确认。
  const [pendingDelete, setPendingDelete] = useState<{
    id: string;
    title: string;
  } | null>(null);
  const [innerCollapsed, setInnerCollapsed] = useState(
    () => localStorage.getItem(COLLAPSE_KEY) === "1",
  );
  const collapsed = controlledCollapsed ?? innerCollapsed;

  // 是否曾经展开过：折叠态靠它决定是否显示「展开侧边栏」按钮。
  const everWide = useRef(!collapsed);
  if (!collapsed) everWide.current = true;

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

  // 展开态与标题栏连成灰底，收起态是白色悬浮卡片。这两套外观必须
  // 一起过渡：此前只过渡 width/min-height，bg-chrome→bg-surface 与
  // margin/圆角/边框/阴影都是瞬间切换，灰色块「啪」地消失一下。
  // 两态都保留 1px 边框（展开态透明）避免 border-width 跳变。
  return (
    <>
    <aside
      className={`aura-sidebar flex shrink-0 flex-col self-start overflow-hidden transition-[width,min-height,max-height,margin,background-color,border-color,border-radius,box-shadow] duration-200 ease-in-out ${
        collapsed
          ? "m-2 max-h-[calc(100%-1rem)] w-14 min-h-0 rounded-card border border-line bg-surface shadow-sm"
          : "m-0 max-h-full min-h-full w-64 rounded-none border border-transparent bg-chrome shadow-none"
      }`}
      style={{ width: collapsed ? undefined : (width ?? undefined) }}
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
        {!collapsed && (
          <button
            type="button"
            onClick={toggleCollapsed}
            aria-label="收起侧边栏"
            title="收起侧边栏"
            className="ml-auto shrink-0 rounded-tag p-1 text-subtle transition-colors hover:bg-bubble hover:text-foreground"
          >
            <PanelLeft size={14} />
          </button>
        )}
        {collapsed && everWide.current && (
          <button
            type="button"
            onClick={toggleCollapsed}
            aria-label="展开侧边栏"
            title="展开侧边栏"
            className="ml-auto shrink-0 rounded-tag p-1 text-subtle transition-colors hover:bg-bubble hover:text-foreground"
          >
            <PanelLeft size={14} />
          </button>
        )}
      </header>

      {/* 顶部导航：新建对话 / Skills / MCP / 轨迹。平铺，不加卡片边框——
          折叠态下边框会在 56px 宽里挤成一条窄条，图标也就跟着偏了。

          pb-3 是刻意留的：此前 nav 与下方会话列表之间一点空隙都没有，
          「轨迹」的下边缘几乎贴着第一条会话，视觉上像挤在一起（实测反馈）。 */}
      <nav className="shrink-0 px-3 pb-3">
        {navBlocks.map((block) => {
          const active = block.panel
            ? activePanel === block.panel
            : block.id !== "new" && view === block.id;
          // 新会话单独成块：带边框的胶囊，悬停露出快捷键提示
          const isNew = block.id === "new";
          return (
            <button
              key={block.id}
              type="button"
              onClick={block.onClick}
              aria-current={active ? "page" : undefined}
              title={isNew ? "新建对话 · Ctrl + N" : collapsed ? block.label : undefined}
              className={`group flex w-full items-center rounded-tag py-2 text-left text-sm transition-colors ${
                collapsed ? "justify-center gap-0 px-0" : "gap-2.5 pl-1 pr-2"
              } ${
                isNew && !collapsed
                  ? "mb-2 border border-line bg-surface shadow-sm hover:border-brand"
                  : ""
              } ${
                active
                  ? "bg-bubble-user font-medium text-foreground"
                  : "text-subtle hover:bg-bubble hover:text-foreground"
              }`}
            >
              {/* 竖线常驻占位，只切换颜色：否则激活瞬间图标会横移 2px */}
              {!collapsed && (
                <span
                  aria-hidden="true"
                  className={`ml-1 h-4 w-0.5 shrink-0 rounded-full ${
                    active ? "bg-brand" : "bg-transparent"
                  }`}
                />
              )}
              <block.icon size={15} className="shrink-0" />
              <span className={`${label} ${collapsed ? labelOff : labelOn}`}>
                {block.label}
              </span>
              {isNew && !collapsed && (
                <kbd className="ml-auto hidden shrink-0 text-[10px] text-subtle group-hover:inline">
                  Ctrl + N
                </kbd>
              )}
            </button>
          );
        })}
      </nav>

      {!collapsed && (
        <div className="px-3 pb-1 pt-2 text-[11px] font-medium tracking-[0.08em] text-subtle">
          工作区
        </div>
      )}

      {/* 工作区列表。折叠态是圆点指示器、展开态是可折叠分组，
          两者结构不同构，只能各自渲染；宽度过渡期间被 overflow-hidden 裁切。
          折叠态不加 flex-1：圆点紧贴下方设置按钮，避免中段被撑出大片空白。 */}
      <div
        className={`scrollbar-hidden min-h-0 overflow-y-auto ${
          collapsed ? "pb-0" : "flex-1 pb-2"
        }`}
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
                                onClick={() =>
                                  setPendingDelete({ id: s.id, title: s.title })
                                }
                                aria-label={`删除对话：${s.title}`}
                                className="mr-1 rounded-tag p-1 text-subtle opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"
                              >
                                <Trash2 size={13} />
                              </button>
                            )}
                          </div>
                        </li>
                      ))}
                      {wsSessions.length === 0 && (
                        <li className="px-2 py-1.5">
                          <p className="text-xs text-subtle">暂无对话</p>
                          {/* 只在当前工作区给出口：新会话落在当前工作区，
                              在别的分组里点会「凭空跑到别处去」。 */}
                          {isCurrent && (
                            <button
                              type="button"
                              onClick={() => {
                                void newSession();
                                onNavigate?.();
                              }}
                              className="mt-1 flex items-center gap-1 text-xs text-brand hover:underline"
                            >
                              <Plus size={11} aria-hidden />
                              新建对话
                            </button>
                          )}
                        </li>
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
      <footer className="mt-auto shrink-0 px-3 pb-3">
        <button
          type="button"
          onClick={onOpenSettings}
          aria-current={view === "settings" ? "page" : undefined}
          className={`flex w-full items-center rounded-tag py-1.5 text-sm transition-colors hover:bg-bubble hover:text-foreground ${
            collapsed ? "justify-center gap-0 px-0" : "gap-2.5 pl-1 pr-2"
          } ${
            view === "settings"
              ? "bg-bubble-user font-medium text-foreground"
              : "text-subtle"
          }`}
        >
          {!collapsed && (
            <span
              aria-hidden="true"
              className={`ml-1 h-4 w-0.5 shrink-0 rounded-full ${
                view === "settings" ? "bg-brand" : "bg-transparent"
              }`}
            />
          )}
          <Settings size={14} className="shrink-0" />
          <span className={`${label} ${collapsed ? labelOff : labelOn}`}>设置</span>
        </button>
      </footer>
    </aside>
    {pendingDelete &&
      createPortal(
        <ConfirmDialog
          title="删除对话？"
          confirmText="删除"
          danger
          onCancel={() => setPendingDelete(null)}
          onConfirm={() => {
            deleteSession(pendingDelete.id);
            setPendingDelete(null);
          }}
        >
          <p className="text-sm leading-relaxed text-subtle">
            将永久删除「{pendingDelete.title}」及其全部消息记录，此操作不可撤销。
          </p>
        </ConfirmDialog>,
        document.body,
      )}
    </>
  );
}