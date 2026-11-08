import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import {
  History,
  Maximize2,
  MessageSquarePlus,
  Minimize2,
  PanelRight,
  Plug,
  Sparkles,
  TriangleAlert,
} from "lucide-react";
import ConfirmDialog from "./components/ConfirmDialog";
import ContextMenu, { type MenuState } from "./components/ContextMenu";
import InputArea from "./components/InputArea";
import MessageList from "./components/MessageList";
import NoticeStack from "./components/NoticeStack";
import Sidebar from "./components/Sidebar";
import StartScreen from "./components/StartScreen";
import TitleBar from "./components/TitleBar";
import { useTheme } from "./hooks/useTheme";
import { useRightbarTransition } from "./hooks/useRightbarTransition";
import { useDropZone } from "./hooks/useDropZone";
import { useConfirm } from "./hooks/useConfirm";
import { checkAllowlistPath } from "./lib/api";
import { decideDrop, formatAttachment, parentDir, stricter, type DropVerdict } from "./lib/drop";
import {
  codeBlockMenuItems,
  findCodeBlockTarget,
  findMessageTarget,
  messageMenuItems,
  textMenuItems,
} from "./lib/contextMenuItems";
import { copyText } from "./lib/clipboard";
import { CONTENT_WIDTH } from "./lib/layout";
import { workspaceMenuItems } from "./lib/workspaceMenu";
import ScrollToBottom, { NEAR_BOTTOM_PX } from "./components/ScrollToBottom";
import TurnNavigator from "./components/TurnNavigator";
import { activeTurnAt, buildTurnItems } from "./lib/turnRail";
import { shouldBlockDevtools } from "./lib/devtools";
import SessionSearch from "./components/SessionSearch";
import SettingsPage from "./pages/SettingsPage";
import McpPage from "./pages/McpPage";
import SkillsPage from "./pages/SkillsPage";
import TimelinePage from "./pages/TimelinePage";
import OpenInMenu from "./components/OpenInMenu";
import { PANEL_BODIES, PANEL_ICONS } from "./components/PanelBodies";
import { StoreProvider, useStore } from "./store";
import { panelRegistry } from "./lib/panels";
import {
  RIGHTBAR_DEFAULT,
  RIGHTBAR_MAX_RATIO,
  RIGHTBAR_MIN,
  SIDEBAR_AUTO_COLLAPSE,
  SIDEBAR_DEFAULT,
  SIDEBAR_MAX,
  SIDEBAR_MIN,
  clampWidth,
  computeColumns,
} from "./lib/columns";

function basename(p: string): string {
  const parts = p.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? p;
}

/** 最近一条用户消息，供输入框上方向键召回 */
function lastUserMessageOf(
  session: { messages: Array<{ role: string; content?: string }> } | undefined,
): string | undefined {
  if (!session) return undefined;
  for (let i = session.messages.length - 1; i >= 0; i -= 1) {
    const m = session.messages[i];
    if (m.role === "user" && m.content) return m.content;
  }
  return undefined;
}

// 右键目标保留原生菜单：可编辑区域（复制粘贴/输入建议），
// 或页面存在选中文本且右键点在选区内（复制/搜索）。其余一律由
// 捕获阶段 contextmenu 监听拦截，避免 WebView 原生页面菜单漏出。
function shouldUseNativeMenu(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.closest("input, textarea, [contenteditable]")) return true;
  const selection = window.getSelection();
  if (selection && !selection.isCollapsed && selection.rangeCount > 0) {
    try {
      const range = selection.getRangeAt(0);
      if (range.intersectsNode(target)) return true;
    } catch {
      /* 节点不在文档树等边缘情况，按非原生处理 */
    }
  }
  return false;
}

function Shell({ theme }: { theme: ReturnType<typeof useTheme> }) {
  const {
    busy,
    sendMessage,
    submitMessage,
    cancelEdit,
    editingUserIndex,
    editPrefill,
    insertIntoInput,
    stop,
    activeSession,
    activeId,
    sessions,
    models,
    selectedModel,
    setModel,
    mode,
    setMode: changeMode,
    workspace,
    newSession,
    openSession,
    setSessionWorkspace,
    startRename,
    deleteSession,
    removeWorkspace,
    sideEffectPrompt,
    setSideEffectPrompt,
    resendFrom,
  } = useStore();
  const [view, setView] = useState<"chat" | "settings" | "skills" | "mcp" | "timeline">(
    "chat",
  );
  // 导航区块要引用 openRightbar，故过渡 hook 必须在 navBlocks 之前声明。
  const {
    shown: rightbarShown,
    closing: rightbarClosing,
    open: openRightbar,
    close: closeRightbar,
  } = useRightbarTransition();
  // 左侧导航默认区块，由 Shell 拥有 onClick 闭包（newSession / setView 等）。
  const navBlocks: { id: string; label: string; icon: React.ComponentType<{ size?: number; className?: string }>; onClick: () => void; panel?: string }[] = useMemo(
    () => [
      {
        id: "new",
        label: "新建对话",
        icon: MessageSquarePlus,
        onClick: () => {
          newSession();
          setView("chat");
        },
      },
      {
        id: "skills",
        label: "Skills",
        icon: Sparkles,
        onClick: () => setView("skills"),
      },
      {
        id: "mcp",
        label: "MCP",
        icon: Plug,
        onClick: () => setView("mcp"),
      },
      {
        id: "timeline",
        label: "轨迹",
        icon: History,
        onClick: () => setView("timeline"),
      },
    ],
    [newSession, setView],
  );
  const [menu, setMenu] = useState<MenuState | null>(null);
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [dropNotice, setDropNotice] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [activeTurn, setActiveTurn] = useState(0);
  const turnItems = useMemo(
    () => buildTurnItems(activeSession?.messages ?? []),
    [activeSession?.messages],
  );
  const [rightbarWidth, setRightbarWidth] = useState(RIGHTBAR_DEFAULT);
  const [rightbarTab, setRightbarTab] = useState<string>("files");
  const [rightbarFullscreen, setRightbarFullscreen] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_DEFAULT);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [narrowExpanded, setNarrowExpanded] = useState(false);
  const [viewport, setViewport] = useState(() => window.innerWidth);

  useEffect(() => {
    const onResize = () => setViewport(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // 面板卸载后复位全屏态，避免下次打开仍是全屏（过渡 hook 不感知全屏）
  useEffect(() => {
    if (!rightbarShown) setRightbarFullscreen(false);
  }, [rightbarShown]);

  const narrow = viewport < SIDEBAR_AUTO_COLLAPSE;
  const sidebarIsCollapsed = narrow ? !narrowExpanded : sidebarCollapsed;
  const toggleSidebar = () => {
    // 窄视口下用户手动展开要能盖过自动折叠，不能点一下就弹回去
    if (narrow) setNarrowExpanded((v) => !v);
    else setSidebarCollapsed((v) => !v);
  };
  const cols = computeColumns(
    viewport,
    sidebarWidth,
    rightbarWidth,
    sidebarIsCollapsed,
    rightbarShown && !rightbarFullscreen,
  );
  // 轨道为 0（视口太窄）或全屏时右栏改走覆盖层，中栏保底宽度不受影响
  const rightbarOverlay = rightbarFullscreen || cols.rightbar === 0;
  const rightbarWidthPx = rightbarFullscreen
    ? Math.max(RIGHTBAR_MIN, viewport - cols.sidebar)
    : cols.rightbar || RIGHTBAR_MIN;
  const panelList = panelRegistry.list();

  /**
   * v0.7.0：拖入文件 → 把路径附加到输入框。
   *
   * 为什么不直接把文件内容塞进消息：模型的工具沙盒只允许工作区与
   * 路径白名单内的目录，让模型自己去读才是正确做法。这里负责的是
   * **把路径告诉用户自己**（用户在输入框里能看到、能改、能删）。
   *
   * 路径的可达性由后端判定（`check_allowlist_path`）：
   * - allow → 直接附加
   * - confirm → 附加，但提示「该目录需要先授权」
   * - reject → 不附加（系统目录、密钥目录）
   */
  const onDropPaths = useCallback(
    async (paths: string[]) => {
      if (paths.length === 0) return;

      // 逐个判定。**自身与父目录都判，取更严的那档**：
      // 拖入的可能是文件也可能是目录，字符串上看不出来，
      // 只判父目录会漏掉「名为 Desktop 的目录」这类情况。
      const verdicts: DropVerdict[] = [];
      for (const p of paths) {
        try {
          const own = await checkAllowlistPath(p);
          const parent = await checkAllowlistPath(parentDir(p));
          verdicts.push(stricter(own.level, parent.level));
        } catch {
          // 判定失败时不擅自丢弃用户的拖入：先附加，
          // 真正的可达性由模型侧的沙盒把关
          verdicts.push("unknown");
        }
      }

      const decision = decideDrop(paths, verdicts);
      if (decision.attach) {
        insertIntoInput(
          formatAttachment(paths.filter((_, i) => verdicts[i] !== "reject")),
        );
      }
      setDropNotice(decision.notice);
    },
    [insertIntoInput],
  );

  useDropZone({
    onDrop: (paths) => {
      void onDropPaths(paths);
    },
    onCancel: () => setDropNotice(null),
  });

  useEffect(() => {
    const el = scrollRef.current;
    if (view !== "chat" || !el) return;
    // 阈值与 ScrollToBottom 共用：两处不一致会出现「按钮还挂着却已经在
    // 自动跟随」这类割裂
    const nearBottom =
      el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
    if (nearBottom) {
      el.scrollTop = el.scrollHeight;
    }
  }, [activeSession?.messages, view]);

  // 右侧时间线：滚动时反推当前轮次。锚点位置用 getBoundingClientRect
  // 相对滚动视口计算，不用 offsetTop —— 后者相对最近的 positioned 祖先，
  // 在这个布局里并不等于内容坐标。
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || view !== "chat") return;
    const update = () => {
      const base = el.getBoundingClientRect().top;
      const anchors = Array.from(
        el.querySelectorAll<HTMLElement>("[data-turn]"),
      );
      const positions = anchors.map(
        (a) => a.getBoundingClientRect().top - base + el.scrollTop,
      );
      setActiveTurn(activeTurnAt(positions, el.scrollTop, el.clientHeight));
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    return () => el.removeEventListener("scroll", update);
  }, [activeSession?.messages, view]);

  const navigateToTurn = useCallback((turn: number) => {
    const el = scrollRef.current;
    if (!el) return;
    const anchor = el.querySelector<HTMLElement>(`[data-turn="${turn}"]`);
    if (!anchor) return;
    const base = el.getBoundingClientRect().top;
    const top = Math.max(
      0,
      anchor.getBoundingClientRect().top - base + el.scrollTop - 16,
    );
    if (typeof el.scrollTo === "function") {
      el.scrollTo({ top, behavior: "smooth" });
    } else {
      el.scrollTop = top;
    }
  }, []);

  // v0.6.3：拦截刷新快捷键。
  // 无边框窗口里 WebView 的 F5 / Ctrl+R 会整页重载——白屏一下再把整个
  // 应用重新启动，用户看起来就是「闪了一下、状态可能丢了」。
  // 本次只拦截不映射行为，留待后续按需定义应用内语义。
  //
  // v0.7.0：Ctrl+F 呼出应用内会话搜索（网页做不到的全局快捷键能力）。
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.ctrlKey && e.key.toLowerCase() === "n") {
        e.preventDefault();
        newSession();
        setView("chat");
        return;
      }
      // Ctrl+F / Ctrl+K 都开搜索：顶栏胶囊提示的是 Ctrl+K，
      // 统一命令面板（C27）落地前先用同一个面板兜住两个入口。
      if (
        (e.ctrlKey && e.key.toLowerCase() === "f") ||
        (e.ctrlKey && e.key.toLowerCase() === "k")
      ) {
        e.preventDefault();
        setSearchOpen(true);
        return;
      }
      if (e.key !== "F5" && !(e.ctrlKey && e.key.toLowerCase() === "r")) return;
      e.preventDefault();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // v0.8.0：正式版吞掉 F12 / Ctrl+Shift+I/J/C，避免终端用户误开检查器。
  // 开发模式（pnpm tauri dev，import.meta.env.PROD=false）**完全不注册**
  // 这个监听，调试能力原样保留。用捕获阶段，抢在 WebView 处理之前。
  useEffect(() => {
    if (!import.meta.env.PROD) return;
    const block = (e: KeyboardEvent) => {
      if (!shouldBlockDevtools(true, e)) return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener("keydown", block, true);
    return () => window.removeEventListener("keydown", block, true);
  }, []);

  function onContextMenu(e: ReactMouseEvent) {
    if (shouldUseNativeMenu(e.target)) return;

    const target = e.target as HTMLElement;
    const sessionEl = target.closest<HTMLElement>("[data-ctx-session]");
    if (sessionEl) {
      e.preventDefault();
      const id = sessionEl.dataset.ctxSession ?? "";
      setMenu({
        x: e.clientX,
        y: e.clientY,
        items: [
          { label: "重命名", onClick: () => startRename(id) },
          { label: "删除", danger: true, onClick: () => deleteSession(id) },
        ],
      });
      return;
    }

    const wsEl = target.closest<HTMLElement>("[data-ctx-workspace]");
    if (wsEl) {
      const path = wsEl.dataset.ctxWorkspace ?? "";
      const items = workspaceMenuItems(path, workspace, (p) => {
        void confirm({
          title: "删除工作区",
          message: `将移除「${basename(p)}」的全部对话记录，磁盘文件不受影响。`,
          confirmText: "删除",
          danger: true,
        }).then((ok) => {
          if (ok) void removeWorkspace(p);
        });
      });
      // 当前工作区没有可提供的操作（不能删除自己）。
      // 此处必须放行原生菜单：若先 preventDefault 再判断，用户右键第一个
      // 工作区时会「自定义菜单不显示、系统菜单也不显示」——什么都不会发生。
      if (items.length === 0) return;
      e.preventDefault();
      setMenu({ x: e.clientX, y: e.clientY, items });
      return;
    }

    // v0.6.3：消息气泡与代码块补自绘菜单。在此之前这一支是
    // preventDefault 却不弹菜单，正文右键什么都不发生。
    const msgEl = findMessageTarget(target);
    if (msgEl) {
      e.preventDefault();
      setMenu({
        x: e.clientX,
        y: e.clientY,
        items: messageMenuItems({
          onCopy: () => void copyText(msgEl.dataset.ctxMessage ?? ""),
        }),
      });
      return;
    }

    const codeEl = findCodeBlockTarget(target);
    if (codeEl) {
      e.preventDefault();
      setMenu({
        x: e.clientX,
        y: e.clientY,
        items: codeBlockMenuItems({
          onCopy: () => void copyText(codeEl.dataset.ctxCodeblock ?? ""),
        }),
      });
      return;
    }

    // 普通正文：提供「复制」。仅当确有选中文本时才给——
    // 空选区复制是无意义的空操作，不如直接禁掉。
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed) {
      e.preventDefault();
      setMenu({
        x: e.clientX,
        y: e.clientY,
        items: textMenuItems({
          onCopy: () => document.execCommand("copy"),
        }),
      });
      return;
    }

    // 既无自绘条目、也无选中内容：禁掉 WebView 原生菜单。
    // 此前此处注释写「统一用原生菜单」与实际代码相反，已修正。
    e.preventDefault();
  }

  /**
   * 输入框的 props。开始界面与普通对话区用的是同一个输入框，
   * 只是外边距不同（`variant`），所以 props 抽成一份。
   */
  /**
   * 「继续上次」的目标会话。
   *
   * 目前会话没有 updated_at（F2 未落地），只能按列表顺序取最后一条有内容的；
   * 等时间戳补齐后换成按时间倒序，这里只改这一处。
   */
  const recentSession = [...sessions].reverse().find((s) => s.messages.length > 0);

  const inputProps = {
    busy,
    onSend: sendMessage,
    onStop: stop,
    models,
    selectedModel,
    onModelChange: setModel,
    mode,
    onModeChange: changeMode,
    workspace: activeSession?.workspace ?? "",
    onWorkspaceChange: setSessionWorkspace,
    workspaceLocked: activeSession ? activeSession.messages.length > 0 : false,
    sessionId: activeSession?.id ?? "",
    sessionTitle: activeSession?.title,
    lastUserMessage: lastUserMessageOf(activeSession),
    editPrefill,
    editing: editingUserIndex !== null,
    onCancelEdit: cancelEdit,
    onSubmit: submitMessage,
  };

  /** 没有消息（或没有会话）→ 走开始界面 */
  const isEmptySession = (activeSession?.messages.length ?? 0) === 0;

  /**
   * 拖放提示：有些路径没被附加，或附加了但需要授权。
   * 这类信息必须说出来——用户看到路径进了输入框就以为
   * 模型一定能读，实际可能读不到。
   */
  const dropBanner = dropNotice ? (
    <div className={`mx-auto mb-2 ${CONTENT_WIDTH}`}>
      <div className="flex items-start gap-2 rounded-card border border-warning bg-surface px-3 py-1.5 text-xs text-foreground">
        <TriangleAlert size={13} className="mt-0.5 shrink-0 text-warning" />
        <span className="min-w-0 flex-1">{dropNotice}</span>
        <button
          type="button"
          onClick={() => setDropNotice(null)}
          aria-label="关闭提示"
          className="shrink-0 rounded-md border border-line px-1.5 text-[11px] text-subtle transition-colors hover:border-brand"
        >
          关闭
        </button>
      </div>
    </div>
  ) : null;

  /**
   * 左右两栏共用一套拖拽。
   *
   * 旧实现把 ref 挂在 1px 宽的拖拽把手上，startWidth 拿到的是 1，
   * 于是 dx 无论怎么累加都被 clamp 成 300 —— 表现为「拖不动」。
   * 现在基准宽度直接取三栏求解的结果，并用 pointer capture 保证
   * 指针移出把手后仍能继续拖。
   */
  const dragRef = useRef<{
    side: "sidebar" | "rightbar";
    startX: number;
    startWidth: number;
  } | null>(null);

  const startDrag =
    (side: "sidebar" | "rightbar") => (e: React.PointerEvent) => {
      e.preventDefault();
      const el = e.currentTarget as HTMLElement;
      el.setPointerCapture(e.pointerId);
      dragRef.current = {
        side,
        startX: e.clientX,
        startWidth: side === "sidebar" ? cols.sidebar : cols.rightbar,
      };
    };

  const moveDrag = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.startX;
    if (d.side === "sidebar") {
      setSidebarWidth(clampWidth(d.startWidth + dx, SIDEBAR_MIN, SIDEBAR_MAX));
    } else {
      // 右栏在左边拖：向右拖 dx>0 应该变窄
      setRightbarWidth(
        clampWidth(d.startWidth - dx, RIGHTBAR_MIN, viewport * RIGHTBAR_MAX_RATIO),
      );
    }
  };

  const endDrag = (e: React.PointerEvent) => {
    dragRef.current = null;
    const el = e.currentTarget as HTMLElement;
    if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
  };

  return (
    <div
      className="flex h-screen flex-col overflow-hidden bg-surface text-foreground"
      onContextMenu={onContextMenu}
    >
      <TitleBar onSearch={() => setSearchOpen(true)} />

      <div className="flex min-h-0 flex-1 relative">
        <Sidebar
          view={view}
          navBlocks={navBlocks}
          activePanel={rightbarShown ? rightbarTab : null}
          onOpenSettings={() => setView("settings")}
          onNavigate={() => setView("chat")}
          width={cols.sidebar}
          collapsed={sidebarIsCollapsed}
          onToggleCollapsed={toggleSidebar}
        />
        {!sidebarIsCollapsed && (
          <div
            className="absolute top-0 bottom-0 z-10 w-1 cursor-col-resize hover:bg-brand/30"
            style={{ left: cols.sidebar - 2 }}
            onPointerDown={startDrag("sidebar")}
            onPointerMove={moveDrag}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            aria-hidden
          />
        )}

        <main className="flex min-w-0 flex-1 flex-col bg-surface">
          {view === "settings" ? (
            <div className="min-h-0 flex-1 overflow-y-auto">
              <SettingsPage onClose={() => setView("chat")} theme={theme} />
            </div>
          ) : view === "skills" ? (
            <div className="min-h-0 flex-1 overflow-y-auto">
              <SkillsPage onClose={() => setView("chat")} />
            </div>
          ) : view === "mcp" ? (
            <div className="min-h-0 flex-1 overflow-y-auto">
              <McpPage onClose={() => setView("chat")} />
            </div>
          ) : view === "timeline" ? (
            <div className="min-h-0 flex-1 overflow-y-auto">
              <TimelinePage onClose={() => setView("chat")} />
            </div>
          ) : isEmptySession ? (
            /* 开始界面（v0.7.0）：图标 + 标题 → 输入框 → 示例内容，
               整体居中成一块。此前标题在消息区、输入框钉在窗口最底，
               两块离得很远，看着像两个不相干的区域。 */
            <>
              {dropBanner}
              <StartScreen
                onPick={(prompt) => insertIntoInput(prompt)}
                recentSession={
                  recentSession
                    ? {
                        title: recentSession.title,
                        onOpen: () => {
                          void openSession(recentSession.id);
                          setView("chat");
                        },
                      }
                    : undefined
                }
                modelLabel={
                  models.find((m) => m.key === selectedModel)?.label ||
                  models.find((m) => m.id === selectedModel)?.label ||
                  selectedModel
                }
              >
                <InputArea {...inputProps} variant="inline" />
              </StartScreen>
            </>
          ) : (
            <>
              {/* relative 让回到底部按钮、右侧时间线以滚动区为定位基准 */}
              <div className="relative min-h-0 flex-1">
                {/* 右上角常驻「在…中打开 / 展开面板」按钮，消息区上边缘
                    必须下移让出它们的高度，否则第一条消息会被盖住。 */}
                <div ref={scrollRef} className="h-full overflow-y-auto">
                  <div className="pt-11">
                    <MessageList />
                  </div>
                </div>
                <TurnNavigator
                  items={turnItems}
                  activeTurn={activeTurn}
                  onNavigate={navigateToTurn}
                />
                <ScrollToBottom
                  scrollRef={scrollRef}
                  messagesLength={activeSession?.messages.length ?? 0}
                />
              </div>
              {dropBanner}
              <InputArea {...inputProps} />
            </>
          )}
        </main>

        {rightbarShown && (
          <aside
            data-state={rightbarClosing ? "closing" : "open"}
            className={`relative flex shrink-0 flex-col overflow-hidden border-l border-line bg-surface ${
              rightbarClosing ? "rightbar-leave" : "rightbar-enter"
            } ${
              rightbarOverlay ? "absolute right-0 top-0 bottom-0 z-20 shadow-lg" : ""
            }`}
            style={{ width: rightbarWidthPx }}
          >
            {!rightbarFullscreen && (
              <div
                className="absolute left-0 top-0 bottom-0 z-10 w-1 cursor-col-resize hover:bg-brand/30"
                onPointerDown={startDrag("rightbar")}
                onPointerMove={moveDrag}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
                aria-hidden
              />
            )}
            <div className="mx-2 mt-2 mb-1 flex items-center gap-1">
              {/* 页签走胶囊内凹轨道，与输入框 ModeTabs 同一套语言：
                  外层浅底容器，选中项白底浮块。tab 列表由注册表派生。 */}
              <div
                role="tablist"
                aria-label="右侧面板"
                className="flex min-w-0 items-center gap-0.5 rounded-full bg-bubble p-0.5"
              >
                {panelList.map((panel) => {
                  const Icon = PANEL_ICONS[panel.id];
                  return (
                    <button
                      key={panel.id}
                      type="button"
                      role="tab"
                      aria-selected={rightbarTab === panel.id}
                      aria-current={rightbarTab === panel.id ? "page" : undefined}
                      onClick={() => setRightbarTab(panel.id)}
                      className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium tracking-[0.04em] transition-colors ${
                        rightbarTab === panel.id
                          ? "bg-surface text-foreground shadow-sm"
                          : "text-subtle hover:text-foreground"
                      }`}
                    >
                      {Icon && <Icon size={12} aria-hidden />}
                      {panel.label}
                    </button>
                  );
                })}
              </div>
              <button
                type="button"
                onClick={() => setRightbarFullscreen((v) => !v)}
                aria-label={rightbarFullscreen ? "退出面板全屏" : "面板全屏"}
                title={rightbarFullscreen ? "退出面板全屏" : "面板全屏"}
                className="ml-auto rounded-tag p-1 text-subtle transition-colors hover:bg-bubble hover:text-foreground"
              >
                {rightbarFullscreen ? (
                  <Minimize2 size={13} aria-hidden />
                ) : (
                  <Maximize2 size={13} aria-hidden />
                )}
              </button>
              <button
                type="button"
                onClick={closeRightbar}
                aria-label="关闭面板"
                title="关闭面板"
                className="rounded-tag p-1 text-subtle transition-colors hover:bg-bubble hover:text-foreground"
              >
                <PanelRight size={13} aria-hidden />
              </button>
            </div>
            {(() => {
              const Body = PANEL_BODIES[rightbarTab];
              return Body ? (
                <Body sessionId={activeId} view={view} />
              ) : (
                <p className="px-3 py-4 text-[11px] text-subtle">
                  未注册的面板：{rightbarTab}
                </p>
              );
            })()}
          </aside>
        )}
        {rightbarShown && (
          <div
            className="absolute top-2 z-30"
            style={{ right: rightbarWidthPx + 8 }}
          >
            <OpenInMenu sessionId={activeId} workspace={workspace} />
          </div>
        )}
        {!rightbarShown && (
          <div className="absolute right-2 top-2 z-10 flex items-center gap-1">
            <OpenInMenu sessionId={activeId} workspace={workspace} />
            <button
              type="button"
              onClick={() => openRightbar()}
              aria-label="打开侧边面板"
              title="打开侧边面板"
              className="rounded-tag p-1.5 text-subtle transition-colors hover:bg-bubble hover:text-foreground"
            >
              <PanelRight size={14} aria-hidden />
            </button>
          </div>
        )}
      </div>

      <ContextMenu state={menu} onClose={() => setMenu(null)} />

      {/* 全局轻提示：右下角堆叠，三处自建横条已归一到这里 */}
      <NoticeStack />

      {searchOpen && (
        <SessionSearch
          sessions={sessions}
          onClose={() => setSearchOpen(false)}
          onOpenSession={(sessionId) => {
            void openSession(sessionId);
            setSearchOpen(false);
          }}
        />
      )}

      {/* 删除工作区走统一确认（useConfirm），与删除会话、移除技能源同一基准线 */}
      {confirmDialog}

      {sideEffectPrompt && (
        <ConfirmDialog
          title="确认重做？"
          confirmText="仍然重做"
          danger
          busy={busy}
          onCancel={() => setSideEffectPrompt(null)}
          onConfirm={() => {
            const { userIndex, text, archive } = sideEffectPrompt;
            setSideEffectPrompt(null);
            void resendFrom(userIndex, text, { archive, force: true });
          }}
        >
          <div className="flex flex-col gap-3">
            <p className="text-sm leading-relaxed text-subtle">
              即将丢弃的内容包含写入或执行操作，重做可能会：
            </p>
            <ul className="ml-4 flex flex-col gap-1.5 text-sm">
              {sideEffectPrompt.targets.map((t, i) => (
                <li key={i} className="flex items-center gap-2">
                  <span className="font-mono text-[12px]">{t}</span>
                  <span className="text-subtle">（写入）</span>
                </li>
              ))}
              {sideEffectPrompt.execs > 0 && (
                <li className="flex items-center gap-2">
                  <span className="font-mono text-[12px]">{sideEffectPrompt.execs} 条命令</span>
                  <span className="text-subtle">（执行）</span>
                </li>
              )}
            </ul>
            <p className="text-xs text-subtle">
              点击「仍然重做」将忽略副作用强制重发；点击「取消」保留当前状态。
            </p>
          </div>
        </ConfirmDialog>
      )}
    </div>
  );
}

export default function App() {
  const themeApi = useTheme();

  return (
    <StoreProvider>
      <Shell theme={themeApi} />
    </StoreProvider>
  );
}
