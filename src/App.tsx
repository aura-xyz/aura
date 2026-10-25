import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { TriangleAlert } from "lucide-react";
import ContextMenu, { type MenuState } from "./components/ContextMenu";
import InputArea from "./components/InputArea";
import MessageList from "./components/MessageList";
import RightPanel from "./components/RightPanel";
import Sidebar from "./components/Sidebar";
import StartScreen from "./components/StartScreen";
import TitleBar from "./components/TitleBar";
import { useTheme, type Theme } from "./hooks/useTheme";
import { useDropZone } from "./hooks/useDropZone";
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
import { workspaceMenuItems } from "./lib/workspaceMenu";
import ScrollToBottom, { NEAR_BOTTOM_PX } from "./components/ScrollToBottom";
import SessionSearch from "./components/SessionSearch";
import SettingsPage from "./pages/SettingsPage";
import McpPage from "./pages/McpPage";
import SkillsPage from "./pages/SkillsPage";
import TimelinePage from "./pages/TimelinePage";
import { StoreProvider, useStore } from "./store";

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

function Shell({ theme, setTheme }: { theme: Theme; setTheme: (t: Theme) => void }) {
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
  } = useStore();
  const [view, setView] = useState<"chat" | "settings" | "skills" | "mcp" | "timeline">(
    "chat",
  );
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [confirmWs, setConfirmWs] = useState<string | null>(null);
  const [dropNotice, setDropNotice] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

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

  // v0.6.3：拦截刷新快捷键。
  // 无边框窗口里 WebView 的 F5 / Ctrl+R 会整页重载——白屏一下再把整个
  // 应用重新启动，用户看起来就是「闪了一下、状态可能丢了」。
  // 本次只拦截不映射行为，留待后续按需定义应用内语义。
  //
  // v0.7.0：Ctrl+F 呼出应用内会话搜索（网页做不到的全局快捷键能力）。
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.ctrlKey && e.key.toLowerCase() === "f") {
        e.preventDefault();
        setSearchOpen((v) => !v);
        return;
      }
      if (e.key !== "F5" && !(e.ctrlKey && e.key.toLowerCase() === "r")) return;
      e.preventDefault();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // 搜索数据：把会话里的消息转成纯文本
  const searchable = useMemo(
    () =>
      sessions.map((sess) => ({
        id: sess.id,
        title: sess.title,
        messages: sess.messages.map((m) => ({
          role: m.role,
          text:
            m.role === "user"
              ? m.content
              : m.blocks
                  .filter((b) => b.kind === "text")
                  .map((b) => (b.kind === "text" ? b.text : ""))
                  .join("\n"),
        })),
      })),
    [sessions],
  );

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
      const items = workspaceMenuItems(path, workspace, (p) => setConfirmWs(p));
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
    <div className="mx-auto mb-2 w-full max-w-4xl xl:max-w-5xl 2xl:max-w-6xl">
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

  return (
    <div
      className="flex h-screen flex-col overflow-hidden bg-surface text-foreground"
      onContextMenu={onContextMenu}
    >
      <TitleBar />

      <div className="flex min-h-0 flex-1">
<Sidebar
          view={view}
          onNew={() => {
   newSession();
    setView("chat");
          }}
      onOpenSettings={() => setView("settings")}
          onOpenSkills={() => setView("skills")}
          onOpenMcp={() => setView("mcp")}
          onOpenTimeline={() => setView("timeline")}
  onNavigate={() => setView("chat")}
        />

        <main className="flex min-w-0 flex-1 flex-col">
          {view === "settings" ? (
            <div className="min-h-0 flex-1 overflow-y-auto">
              <SettingsPage
                onClose={() => setView("chat")}
                theme={theme}
                setTheme={setTheme}
              />
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
              <StartScreen onPick={(prompt) => insertIntoInput(prompt)}>
                <InputArea {...inputProps} variant="inline" />
              </StartScreen>
            </>
          ) : (
            <>
              {/* relative 让回到底部按钮以滚动区为定位基准 */}
              <div className="relative min-h-0 flex-1">
                <div ref={scrollRef} className="h-full overflow-y-auto">
                  <MessageList />
                </div>
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

        {view === "chat" && <RightPanel />}
      </div>

      <ContextMenu state={menu} onClose={() => setMenu(null)} />

      {searchOpen && (
        <SessionSearch
          sessions={searchable}
          onClose={() => setSearchOpen(false)}
          onOpenSession={(sessionId) => {
            void openSession(sessionId);
            setSearchOpen(false);
          }}
        />
      )}

      {confirmWs && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
          onClick={() => setConfirmWs(null)}
        >
          <div
            role="alertdialog"
            aria-modal="true"
            aria-label="删除工作区"
            className="w-80 rounded-card border border-line bg-surface p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-sm font-semibold">删除工作区</h3>
            <p className="mt-2 text-sm leading-relaxed text-subtle">
              将移除「{basename(confirmWs)}」的全部对话记录，磁盘文件不受影响。
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmWs(null)}
                className="rounded-full border border-line px-4 py-1.5 text-sm text-subtle transition-colors hover:text-foreground"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => {
                  removeWorkspace(confirmWs);
                  setConfirmWs(null);
                }}
                className="rounded-full bg-danger px-4 py-1.5 text-sm text-white transition-colors hover:opacity-90 dark:text-surface"
              >
                删除
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function App() {
  const { theme, setTheme } = useTheme();

  return (
    <StoreProvider>
      <Shell theme={theme} setTheme={setTheme} />
    </StoreProvider>
  );
}
