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
import ApprovalCard from "./components/ApprovalCard";
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
import {
  checkAllowlistPath,
  listSkills,
  listWorkspaceFiles,
  type FileCandidate,
  type SkillView,
} from "./lib/api";
import { decideDrop, formatAttachment, parentDir, stricter, type DropVerdict } from "./lib/drop";
import {
  codeBlockMenuItems,
  findCodeBlockTarget,
  findMessageTarget,
  messageMenuItems,
  textMenuItems,
} from "./lib/contextMenuItems";
import { copyText } from "./lib/clipboard";
import { downloadSessionZip } from "./lib/exportSession";
import { bindApprovalEvents } from "./lib/approvals";
import { notify } from "./lib/notices";
import { recordUse } from "./lib/frecency";
import { CONTENT_WIDTH } from "./lib/layout";
import { workspaceMenuItems } from "./lib/workspaceMenu";
import ScrollToBottom, { NEAR_BOTTOM_PX } from "./components/ScrollToBottom";
import TurnNavigator from "./components/TurnNavigator";
import { activeTurnAt, buildTurnItems } from "./lib/turnRail";
import { shouldBlockDevtools } from "./lib/devtools";
import { useShortcuts } from "./hooks/useShortcuts";
import { resolveAction } from "./lib/shortcuts";
import { closeTopOverlay } from "./lib/overlayStack";
import { focusInput } from "./lib/focusInput";
import ErrorBoundary from "./components/ErrorBoundary";
import StreamFailureBar from "./components/StreamFailureBar";
import ContextWaterAlert from "./components/ContextWaterAlert";
import { installGlobalErrorHandlers } from "./lib/globalErrors";
import {
  actionCommandItems,
  nextMode,
  type CommandItem,
} from "./lib/commandItems";
import {
  filePaletteItems,
  sessionPaletteItems,
  skillPaletteItems,
} from "./lib/palette";
import SessionSearch from "./components/SessionSearch";
import CommandPalette from "./components/CommandPalette";
import SettingsPage from "./pages/SettingsPage";
import McpPage from "./pages/McpPage";
import SkillsPage from "./pages/SkillsPage";
import TimelinePage from "./pages/TimelinePage";
import OpenInMenu from "./components/OpenInMenu";
import SidebarTabBar from "./components/SidebarTabBar";
import SidebarTabBody from "./components/SidebarTabBody";
import { StoreProvider, useStore } from "./store";
import {
  START_CONTENT_ID,
  activateTab,
  canCloseTab,
  closeTab,
  emptyTabsState,
  loadTabsState,
  openTab,
  saveTabsState,
  terminalContentId,
  type SidebarTabKind,
  type SidebarTabsState,
} from "./lib/sidebarTabs";
import { disposeTerminalSession } from "./lib/terminalSessions";
import {
  rightbarDefaultWidth,
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
  // 可配置全局快捷键（v0.8.1）：键位表由设置页维护，这里只负责查表分发。
  // 声明在 navBlocks 之前：折叠态侧栏的 Tooltip 要展示实际键位。
  const shortcuts = useShortcuts();
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
        // 折叠态侧栏的 Tooltip 展示实际键位（用户改过键位后不能失真）
        shortcut: shortcuts.newSession,
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
    [newSession, setView, shortcuts],
  );
  const [menu, setMenu] = useState<MenuState | null>(null);
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [dropNotice, setDropNotice] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  /** 全局命令面板（Ctrl+K）。 */
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState("");
  const [paletteSkills, setPaletteSkills] = useState<SkillView[]>([]);
  const [paletteFiles, setPaletteFiles] = useState<FileCandidate[]>([]);
  const [paletteLoading, setPaletteLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [activeTurn, setActiveTurn] = useState(0);
  const turnItems = useMemo(
    () => buildTurnItems(activeSession?.messages ?? []),
    [activeSession?.messages],
  );
  /** 上下文预警条与输入框里的水位条共用同一个上限口径。 */
  const contextLimit = useMemo(
    () =>
      models.find((m) => m.key === selectedModel)?.context_limit ??
      models.find((m) => m.id === selectedModel)?.context_limit,
    [models, selectedModel],
  );
  // 初始宽度按视口算一次：屏幕宽就多给右栏（网页/终端要横向空间），
  // 之后再被用户拖拽覆盖。窗口尺寸变化不重新算——用户拖过的宽度不该
  // 被一次最大化重置。
  const [rightbarWidth, setRightbarWidth] = useState(() =>
    rightbarDefaultWidth(typeof window === "undefined" ? 1280 : window.innerWidth),
  );
  const [rightbarFullscreen, setRightbarFullscreen] = useState(false);
  /**
   * 右栏改成标签页后，状态从「选中的分区」变成「标签集合 + 当前标签」。
   * 存档只认标签的**内容身份**，终端标签不持久化——shell 进程活不过重启。
   */
  const [tabsState, setTabsState] = useState<SidebarTabsState>(() => {
    const saved = loadTabsState();
    if (saved) return saved;
    return openTab(emptyTabsState(), "start", START_CONTENT_ID, "开始页");
  });
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_DEFAULT);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [narrowExpanded, setNarrowExpanded] = useState(false);
  const [viewport, setViewport] = useState(() => window.innerWidth);

  useEffect(() => {
    const onResize = () => setViewport(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // 命令审批事件（v0.8.0 C41）。绑在 Shell 上而不是审批卡里：
  // 用户可能正在设置页翻东西，后端照样会发请求，卡片挂载时再订阅就漏了。
  useEffect(() => {
    let unbind: (() => void) | undefined;
    let disposed = false;
    void bindApprovalEvents().then((un) => {
      if (disposed) un();
      else unbind = un;
    });
    return () => {
      disposed = true;
      unbind?.();
    };
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

  /**
   * 打开一个标签。
   *
   * 同类标签的内容身份决定它是不是同一个：
   * - 文件 / 任务 / 用量 各只有一个，内容身份固定；
   * - 网页每次新开一个身份（不同标签各自独立的历史）；
   * - 终端用进程 id 当身份，所以开几个就是几个 shell。
   */
  const terminalSeq = useRef(0);
  const openSidebarTab = useCallback(
    (kind: SidebarTabKind, params?: Record<string, string>) => {
      setTabsState((state) => {
        switch (kind) {
          case "start":
            return openTab(state, "start", START_CONTENT_ID, "开始页");
          case "files":
            return openTab(state, "files", "workspace", "文件");
          case "web":
            return openTab(state, "web", `web:${crypto.randomUUID()}`, "新标签页");
          case "terminal": {
            terminalSeq.current += 1;
            const id = `term${terminalSeq.current}`;
            const n = state.tabs.filter((t) => t.kind === "terminal").length + 1;
            return openTab(
              state,
              "terminal",
              terminalContentId(id),
              `终端 ${n}`,
              params,
            );
          }
          case "todo":
            return openTab(state, "todo", "todo", "任务");
          case "usage":
            return openTab(state, "usage", "usage", "用量");
        }
      });
    },
    [],
  );

  /** 关闭标签。关掉终端标签要把对应的 shell 进程一并结束。 */
  const closeSidebarTab = useCallback((tabId: string) => {
    setTabsState((state) => {
      const tab = state.tabs.find((t) => t.id === tabId);
      if (!tab) return state;
      if (tab.kind === "terminal") {
        void disposeTerminalSession(tab.contentId.replace(/^terminal:/, ""));
      }
      return closeTab(state, tabId);
    });
  }, []);

  useEffect(() => {
    saveTabsState(tabsState);
  }, [tabsState]);

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

  /** 供全局快捷键读取最新模式：effect 只注册一次监听，不能依赖 mode。 */
  const modeRef = useRef(mode);
  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  // 全局快捷键已在前方声明；这里只取引用供 keydown 闭包读取最新键位。
  const shortcutsRef = useRef(shortcuts);
  // 直接赋值而非 effect：改完键位的那一帧就该生效，不能落后一个渲染周期
  shortcutsRef.current = shortcuts;

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.isComposing) return;
      // 无边框窗口里 WebView 的 F5 / Ctrl+R 会整页重载——白屏一下再把整个
      // 应用重新启动。这是固定保护，不作为可配置动作（否则用户一改就失去保护）。
      if (e.key === "F5" || (e.ctrlKey && e.key.toLowerCase() === "r")) {
        e.preventDefault();
        return;
      }
      const action = resolveAction(e, shortcutsRef.current);
      if (!action) return;
      e.preventDefault();
      switch (action) {
        case "newSession":
          newSession();
          setView("chat");
          break;
        // 模式循环：Tab 已还给焦点移动（WCAG 无键盘陷阱），改用组合键。
        case "cycleMode":
          changeMode(nextMode(modeRef.current));
          break;
        case "openSessionSearch":
          setSearchOpen(true);
          break;
        case "openCommandPalette":
          setPaletteOpen((v) => !v);
          setPaletteQuery("");
          break;
        case "openSettings":
          setView((v) => (v === "settings" ? "chat" : "settings"));
          break;
        case "toggleSidebar":
          setSidebarCollapsed((v) => !v);
          break;
        case "toggleRightbar":
          if (rightbarShown) closeRightbar();
          else openRightbar();
          break;
        // 三个面板入口：Ctrl+P 在 WebView 里默认是「打印」，Ctrl+T 默认是
        // 「恢复刚关闭的标签页」，都必须先 preventDefault 再打开。
        case "openFiles":
          openRightbar();
          openSidebarTab("files");
          break;
        case "openWeb":
          openRightbar();
          openSidebarTab("web");
          break;
        case "openTerminal":
          openRightbar();
          openSidebarTab("terminal");
          break;
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    newSession,
    changeMode,
    openRightbar,
    closeRightbar,
    rightbarShown,
    openSidebarTab,
  ]);

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

  // v0.8.1 P09：Esc 只关最上层浮层。捕获阶段抢在各浮层自己的监听之前，
  // 命中后 stopPropagation，避免一次 Esc 连关两层或关错层；栈为空时
  // 完全不拦截，小下拉等未入栈的浮层沿用各自的处理。
  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.isComposing) return;
      if (!closeTopOverlay()) return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener("keydown", onEsc, true);
    return () => window.removeEventListener("keydown", onEsc, true);
  }, []);

  // 新建 / 切换会话、从设置页返回对话后把焦点交回输入框
  useEffect(() => {
    if (view === "chat") focusInput();
  }, [view, activeId]);

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

  // ── 全局命令面板（Ctrl+K）────────────────────────────────────
  // 技能在打开时拉一次；文件随查询去后端捞（带 250ms 防抖，避免每敲一个字都发请求）。
  useEffect(() => {
    if (!paletteOpen) return;
    let live = true;
    listSkills()
      .then((rows) => {
        if (live) setPaletteSkills(rows);
      })
      .catch(() => {
        if (live) setPaletteSkills([]);
      });
    return () => {
      live = false;
    };
  }, [paletteOpen]);

  useEffect(() => {
    if (!paletteOpen) {
      setPaletteFiles([]);
      return;
    }
    const q = paletteQuery.trim();
    if (!q || !activeId) {
      setPaletteFiles([]);
      setPaletteLoading(false);
      return;
    }
    let live = true;
    setPaletteLoading(true);
    const timer = window.setTimeout(() => {
      listWorkspaceFiles(activeId, q, 8)
        .then((rows) => {
          if (live) setPaletteFiles(rows);
        })
        .catch(() => {
          if (live) setPaletteFiles([]);
        })
        .finally(() => {
          if (live) setPaletteLoading(false);
        });
    }, 250);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [paletteOpen, paletteQuery, activeId]);

  const paletteItems = useMemo<CommandItem[]>(() => {
    if (!paletteOpen) return [];
    return [
      ...actionCommandItems({ mode, theme: theme.theme }),
      ...sessionPaletteItems(sessions, paletteQuery),
      ...skillPaletteItems(paletteSkills, paletteQuery),
      ...filePaletteItems(paletteFiles),
    ];
    // 只用到 theme.theme，其余主题字段变化不该重建列表
  }, [paletteOpen, mode, theme.theme, sessions, paletteQuery, paletteSkills, paletteFiles]);

  /** 执行面板项：按 id 前缀分派，动作项再看具体键。 */
  function runPaletteItem(item: CommandItem) {
    // 先记一次使用，下次打开时它自己会浮上来
    recordUse(item.id);
    const [kind, ...rest] = item.id.split(":");
    const value = rest.join(":");
    setPaletteOpen(false);
    if (kind === "session") {
      // value 形如 `{sessionId}:{messageIndex}`；目前只切会话，
      // 命中消息的定位留给会话内搜索（与 Ctrl+F 面板的现有行为一致）。
      const [sessionId] = value.split(":");
      void openSession(sessionId);
      return;
    }
    if (kind === "skill") {
      insertIntoInput(`/${value} `);
      return;
    }
    if (kind === "file") {
      insertIntoInput(`@${value}`);
      return;
    }
    // action:*
    if (value === "new") {
      void newSession();
      setView("chat");
    } else if (value.startsWith("mode:")) {
      changeMode(value.slice(5) as typeof mode);
    } else if (value.startsWith("theme:")) {
      theme.setTheme(value.slice(6) as "light" | "dark" | "system");
    } else if (value === "settings") {
      setView("settings");
    } else if (value === "skills") {
      setView("skills");
    } else if (value === "mcp") {
      setView("mcp");
    } else if (value === "timeline") {
      setView("timeline");
    } else if (value === "export") {
      if (activeSession) {
        void downloadSessionZip(activeSession.id, activeSession.title)
          .then((ok) => {
            if (ok) notify("ok", "日志已导出");
          })
          .catch((e) => notify("error", `导出失败：${String(e)}`));
      }
    }
  }

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
      <TitleBar
        onSearch={() => {
          setPaletteOpen(true);
          setPaletteQuery("");
        }}
      />

      <div className="flex min-h-0 flex-1 relative">
        <Sidebar
          view={view}
          navBlocks={navBlocks}
          activePanel={
            rightbarShown
              ? (tabsState.tabs.find((t) => t.id === tabsState.activeId)?.kind ??
                null)
              : null
          }
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
              {activeSession && <ApprovalCard sessionId={activeSession.id} />}
              <ContextWaterAlert contextLimit={contextLimit} />
              <StreamFailureBar />
              <InputArea {...inputProps} />
            </>
          )}
        </main>

        {/* 收起时**保持挂载**（仅 display:none），不卸载子组件：
            否则已打开的文件夹/网页/终端标签与内容会在收起后丢失，
            重新展开就是一张白板。 */}
        <aside
          data-state={
            rightbarClosing ? "closing" : rightbarShown ? "open" : "hidden"
          }
          className={`relative flex shrink-0 flex-col overflow-hidden border-l border-line bg-surface ${
            rightbarClosing ? "rightbar-leave" : "rightbar-enter"
          } ${
            rightbarOverlay ? "absolute right-0 top-0 bottom-0 z-20 shadow-lg" : ""
          } ${rightbarShown ? "" : "hidden"}`}
          style={{ width: rightbarWidthPx }}
        >
            {!rightbarFullscreen && (
              // 拖拽手柄：加宽到 6px 并给一条居中的抓手线——
              // 原来只有 1px 宽、hover 才显色，几乎没人发现得了它能拖。
              // 注意这里在 JS 表达式里，注释必须是 // 而不是 {/* */}。
              <div
                className="group absolute left-0 top-0 bottom-0 z-10 w-1.5 cursor-col-resize"
                onPointerDown={startDrag("rightbar")}
                onPointerMove={moveDrag}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
                aria-hidden
              >
                <span className="absolute left-1/2 top-1/2 h-12 w-px -translate-x-1/2 -translate-y-1/2 rounded-full bg-line transition-colors group-hover:bg-brand" />
              </div>
            )}
            <SidebarTabBar
              tabs={tabsState.tabs}
              activeId={tabsState.activeId}
              canClose={(tabId) => canCloseTab(tabsState, tabId)}
              onActivate={(tabId) =>
                setTabsState((state) => activateTab(state, tabId))
              }
              onClose={closeSidebarTab}
              onNew={openSidebarTab}
              trailing={
                <>
                  <button
                    type="button"
                    onClick={() => setRightbarFullscreen((v) => !v)}
                    aria-label={rightbarFullscreen ? "退出面板全屏" : "面板全屏"}
                    title={rightbarFullscreen ? "退出面板全屏" : "面板全屏"}
                    className="shrink-0 rounded-tag p-1 text-subtle transition-colors hover:bg-bubble hover:text-foreground"
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
                    className="shrink-0 rounded-tag p-1 text-subtle transition-colors hover:bg-bubble hover:text-foreground"
                  >
                    <PanelRight size={13} aria-hidden />
                  </button>
                </>
              }
            />
            {/* 标签页的正文区。所有标签都保持挂载，未激活的用 hidden 藏起来——
                终端进程要继续跑，切回来时屏幕还在；xterm 重建后由会话注册表
                把此前的输出回放进去。 */}
            <div className="relative min-h-0 flex-1">
              {tabsState.tabs.map((tab) => (
                <div
                  key={tab.id}
                  // flex flex-col：正文根节点是 flex-1 的纵向容器，
                  // 父层不给 flex 上下文时它只能按内容高排，
                  // iframe / xterm 这类「撑满父容器」的组件会塌成很小一块。
                  className={`absolute inset-0 flex flex-col ${
                    tab.id === tabsState.activeId ? "" : "hidden"
                  }`}
                >
                  <SidebarTabBody
                    tab={tab}
                    sessionId={activeId}
                    view={view}
                    model={selectedModel}
                    active={tab.id === tabsState.activeId}
                    onOpen={openSidebarTab}
                  />
                </div>
              ))}
            </div>
        </aside>
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

      {paletteOpen && (
        <CommandPalette
          items={paletteItems}
          loading={paletteLoading}
          onQueryChange={setPaletteQuery}
          onPick={runPaletteItem}
          onClose={() => setPaletteOpen(false)}
        />
      )}

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

  // v0.8.1 P11：事件回调异常 / 未处理的 Promise 拒绝统一进 toast。
  // 装在 ErrorBoundary 外面，即便 Shell 崩了兜底也还活着。
  useEffect(() => installGlobalErrorHandlers(), []);

  return (
    <ErrorBoundary>
      <StoreProvider>
        <Shell theme={themeApi} />
      </StoreProvider>
    </ErrorBoundary>
  );
}
