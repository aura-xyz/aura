import { listen } from "@tauri-apps/api/event";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  getModels,
  getSelectedModel,
  getWorkspace,
  loadSessions,
  notify as notifyApi,
  removeSession,
  removeWorkspace as removeWorkspaceApi,
  saveSession,
  saveTodos as saveTodosApi,
  sendMessage as sendMessageApi,
  setSelectedModel as setSelectedModelApi,
  setWorkspace,
  stopMessage as stopMessageApi,
  truncateHistory as truncateHistoryApi,
  type ModelInfo,
} from "./lib/api";
import { type Mode } from "./lib/mode";
import {
  keepThroughForResend,
  sliceForResend,
} from "./lib/history";
import {
  archiveCurrent,
  removedAssistant,
  switchVersion,
} from "./lib/versions";
import {
  applyAutoClear,
  isTodoStatus,
  normalizeTodos,
  nextTodoId,
  type Todo,
  type TodoStatus,
} from "./lib/todo";

// 统一工作区键：反斜杠转 /，并剥离 Windows 扩展路径的 //?/ 前缀，
// 保证与 Rust 侧 canonicalize 后的键一致
const normWs = (p: string) => p.replace(/\\/g, "/").replace(/^\/\/\?\//, "");

export type BlockKind = "text" | "action" | "notice" | "error";

export interface Block {
  kind: BlockKind;
  text: string;
  /** action 块专用：工具是否执行成功 */
  ok?: boolean;
  /** action 块专用：可折叠的详细输出（命令 stdout/stderr、失败原因） */
  detail?: string;
  /** action 块专用：工具调用耗时（毫秒）。后端在工具执行完后才 emit */
  durationMs?: number;
  /** action 块专用：文件修改的前后内容（v0.7.0），用于差异视图 */
  diff?: {
    path: string;
    before: string;
    after: string;
  };
}

/**
 * 一条 assistant 回答的一个版本（v0.7.0）。
 *
 * 重新生成会产生新版本，旧版本保留在这里供切换回看。
 */
export interface AssistantVersion {
  id: string;
  blocks: Block[];
  /** 生成时间（毫秒时间戳） */
  createdAt: number;
}

export type ChatMessage =
  | { id: string; role: "user"; content: string }
  | {
      id: string;
      role: "assistant";
      /** 当前显示的版本内容 */
      blocks: Block[];
      /**
       * 历史版本（v0.7.0）。
       *
       * **切换版本只改显示，不回滚后端上下文**——上下文始终基于最新版本。
       * 界面必须明确标注这一点，否则用户会以为后续对话是基于他正在看的
       * 那个版本进行的。
       */
      versions?: AssistantVersion[];
      /** 当前显示的是第几个版本（1-based）。缺省表示显示最新 */
      viewingVersion?: number;
      /**
       * 最新版本的内容。切到历史版本时把最新那份挪到这里，
       * 切回来时才能恢复——否则「切走再切回」会把最新版本弄丢。
       */
      latestBlocks?: Block[];
    };

export interface Session {
  id: string;
  title: string;
  workspace: string;
  messages: ChatMessage[];
  /** 任务清单。旧会话可能没有，按空处理 */
  todos: Todo[];
}

interface State {
  workspaces: string[];
  workspace: string;
  sessions: Session[];
  activeId: string;
  busy: boolean;
  models: ModelInfo[];
  selectedModel: string;
  /** 当前会话模式，每次发送时随消息带上 */
  mode: Mode;
}

interface StoreValue extends State {
  activeSession: Session | undefined;
  renamingId: string | null;
  startRename: (id: string) => void;
  cancelRename: () => void;
  renameSession: (id: string, title: string) => void;
  sendMessage: (text: string) => Promise<void>;
  /**
   * 回滚到第 userIndex 条用户消息并重新发送 `text`。
   * 「重新生成」与「编辑消息并重跑」共用。
   */
  resendFrom: (
    userIndex: number,
    text: string,
    options?: { archive?: boolean },
  ) => Promise<void>;
  /**
   * 切换某条 assistant 消息显示的版本（v0.7.0）。
   * 只改显示，不回滚后端上下文。
   */
  switchMessageVersion: (messageId: string, index: number) => void;
  /**
   * 当前是否处于「编辑某条历史消息」状态。
   * 编辑时把原文放回输入框，用户改完直接发送——不走弹窗。
   */
  editingUserIndex: number | null;
  /** 进入编辑状态时把原文放回输入框；null 表示不在编辑 */
  editPrefill: string | null;
  /** 待插入输入框的文本（null 表示没有） */
  inputInsert: { text: string; id: number } | null;
  /** 往输入框插入一段文本（拖放文件路径时用） */
  insertIntoInput: (text: string) => void;
  /** 进入编辑状态（把原文放回输入框） */
  beginEdit: (userIndex: number, text: string) => void;
  /** 退出编辑状态 */
  cancelEdit: () => void;
  /**
   * 提交输入框内容。若处于编辑状态则走「回滚 + 重发」，
   * 否则是普通发送。输入框只需调这一个入口。
   */
  submitMessage: (text: string) => Promise<void>;
  stop: () => Promise<void>;
  switchWorkspace: (path: string) => Promise<void>;
  newSession: () => Promise<void>;
  setSessionWorkspace: (path: string) => Promise<void>;
  selectSession: (id: string) => void;
  openSession: (id: string) => Promise<void>;
  deleteSession: (id: string) => void;
  removeWorkspace: (path: string) => Promise<void>;
  setModel: (id: string) => Promise<void>;
  setMode: (m: Mode) => void;
  deleteTodoStep: (id: string) => void;
  addTodoStep: (title: string) => void;
  setTodoStatus: (id: string, status: TodoStatus) => void;
  refreshModels: () => Promise<void>;
}

const StoreContext = createContext<StoreValue | null>(null);

interface StreamTarget {
  sessionId: string;
  messageId: string;
  /**
   * 打字机正在写入的 text block 下标。
   *
   * 不能只看「最后一个 block」：模型输出「先说一句」再调工具时，
   * 动作卡片会在文字**还没被打字机消费**时就插入。若打字机届时才发现
   * 末块不是 text，就会新开一块——文字被挤到动作卡片**后面**，
   * 与模型实际输出顺序相反。
   */
  textIndex: number;
}

/**
 * 新建一个尚未落库的会话。
 *
 * `workspace` 默认为空串，表示「还没定在哪个目录工作」。这样的会话不进
 * 侧边栏工作区列表（那里只列出有消息的会话），也不会被 `save_session`
 * 写进库——`purge_empty_sessions` 同样会清理空工作区的行。
 */
function createSession(workspace = ""): Session {
  return {
    id: crypto.randomUUID(),
    title: "新对话",
    workspace,
    messages: [],
    todos: [],
  };
}

function deriveTitle(text: string): string {
  const t = text.trim();
  return t.length > 20 ? `${t.slice(0, 20)}…` : t;
}

/** 最后一条 assistant 消息的 id。回滚失败时要把错误挂到它上面。 */
function lastAssistantId(messages: ChatMessage[]): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "assistant") return messages[i].id;
  }
  return undefined;
}

/**
 * 窗口是否在后台（用户看不到）。
 *
 * 用 `document.visibilityState`：窗口最小化或被其它窗口遮住时，
 * WebView 的可见性会变成 hidden。这是浏览器里唯一可靠的判据——
 * 没有「窗口是否被遮住」的 API，而「被遮住」恰恰是最该通知的场景。
 */
function isWindowInBackground(): boolean {
  if (typeof document === "undefined") return false;
  return document.visibilityState === "hidden";
}

/** 取最后一条回复的摘要，用作通知正文。 */
function summarizeReply(messages: ChatMessage[] | undefined): string {
  if (!messages) return "任务已完成";
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === "assistant") {
      const text = m.blocks
        .filter((b) => b.kind === "text")
        .map((b) => (b.kind === "text" ? b.text : ""))
        .join(" ")
        .trim();
      if (text) {
        return text.length > 80 ? `${text.slice(0, 80)}…` : text;
      }
      return "任务已完成";
    }
  }
  return "任务已完成";
}

/**
 * 选定某工作区应激活的会话。
 *
 * 只考虑**有消息**的：空对话只是内存里的草稿，不该把用户从正在看的
 * 对话拽走。sessions 从数据库加载时按 updated_at DESC 排列，故首项最新。
 */
function pickSessionInWorkspace(
  sessions: Session[],
  ws: string,
): Session | undefined {
  return sessions.find(
    (x) => x.workspace === ws && x.messages.length > 0,
  );
}

/** 进侧边栏的会话：发过第一条消息才确定工作区、才归类显示。 */
function listedSessions(sessions: Session[]): Session[] {
  return sessions.filter((s) => s.messages.length > 0);
}

/**
 * 把一段文本合并到「打字机当前正在写」的 block 上；该位置还不是 text
 * （尚未写出任何字符，或已被别的 block 占据）就在末尾新建。
 *
 * 返回新的下标：调用方要把它写回 [`StreamTarget.textIndex`]，否则后续
 * 打字机又会去合并到旧位置，文本会跳到 action 卡片前面。
 */
export function appendText(
  blocks: Block[],
  index: number,
  text: string,
): { blocks: Block[]; index: number } {
  const i = Math.min(index, blocks.length);
  const cur = blocks[i];
  if (cur && cur.kind === "text") {
    const next = [...blocks];
    next[i] = { ...cur, text: cur.text + text };
    return { blocks: next, index: i };
  }
  return { blocks: [...blocks, { kind: "text", text }], index: blocks.length };
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>({
    workspaces: [],
    workspace: "",
    sessions: [],
    activeId: "",
    busy: false,
    models: [],
    selectedModel: "",
    mode: "chat",
  });

  const stateRef = useRef(state);
  stateRef.current = state;

  const [renamingId, setRenamingId] = useState<string | null>(null);

  // 编辑状态（v0.7.0）：正在编辑第几条用户消息，以及要放回输入框的原文。
  // 单独存一份 ref 是为了让 submitMessage 在 useCallback 依赖稳定的前提下
  // 也能读到最新值——它被 InputArea 直接调用，闭包过期会导致
  // 「编辑了却走普通发送」这种难查的错。
  const [editingUserIndex, setEditingUserIndex] = useState<number | null>(null);
  const [editPrefill, setEditPrefill] = useState<string | null>(null);
  const editingUserIndexRef = useRef<number | null>(null);
  editingUserIndexRef.current = editingUserIndex;

  // 待插入输入框的文本（v0.7.0 拖放用）。
  // 用自增 id 而不是纯字符串：连续插入同一段文本时要能被区分开，
  // 否则 InputArea 的 effect 不会再次触发。
  const [inputInsert, setInputInsert] = useState<{ text: string; id: number } | null>(
    null,
  );
  const insertSeq = useRef(0);

  // 待归档的历史版本（v0.7.0）：「重新生成」时先记下旧回答的 blocks，
  // 等新消息创建时挂上去。用 ref 是因为 sendMessage 与 resendFrom 之间
  // 隔着一次异步调用，闭包传参容易漏。
  const pendingVersionsRef = useRef<AssistantVersion[] | undefined>(undefined);

  const startRename = useCallback((id: string) => setRenamingId(id), []);
  const cancelRename = useCallback(() => setRenamingId(null), []);

  const bufferRef = useRef("");
  const streamRef = useRef<StreamTarget | null>(null);
  const sawErrorRef = useRef(false);

  const persistNow = useCallback(
    (id: string, title: string, workspace: string, messages: ChatMessage[]) => {
      saveSession(id, title, workspace, messages).catch(() => {});
    },
    [],
  );

  const renameSession = useCallback(
    (id: string, title: string) => {
      const t = title.trim();
      if (!t) return;
      const sess = stateRef.current.sessions.find((x) => x.id === id);
      if (!sess) return;
      setState((s) => ({
        ...s,
        sessions: s.sessions.map((x) => (x.id === id ? { ...x, title: t } : x)),
      }));
      persistNow(id, t, sess.workspace, sess.messages);
    },
    [persistNow],
  );

  const appendBlocks = useCallback(
    (sessionId: string, messageId: string, updater: (blocks: Block[]) => Block[]) => {
      setState((s) => ({
        ...s,
        sessions: s.sessions.map((sess) => {
          if (sess.id !== sessionId) return sess;
          return {
            ...sess,
            messages: sess.messages.map((m) =>
              m.id === messageId && m.role === "assistant"
                ? { ...m, blocks: updater(m.blocks) }
                : m,
            ),
          };
        }),
      }));
    },
    [],
  );

  /**
   * 把缓冲区里尚未渲染的文字**立即**落到消息里。
   *
   * action / notice / error 插入之前必须先调它：这些块走的是直接 append，
   * 不经过打字机缓冲。若不排空，模型「先说一句再调工具」时动作卡片会
   * 排在那句话**前面**。
   */
  const flushBuffer = useCallback(() => {
    const buf = bufferRef.current;
    const stream = streamRef.current;
    if (!buf || !stream) return;
    bufferRef.current = "";
    appendBlocks(stream.sessionId, stream.messageId, (b) => {
      const r = appendText(b, stream.textIndex, buf);
      stream.textIndex = r.index;
      return r.blocks;
    });
  }, [appendBlocks]);

  /** 打字机消费一段文字：合并到当前正在写的 text block。 */
  const writeToStream = useCallback(
    (stream: StreamTarget, text: string) => {
      appendBlocks(stream.sessionId, stream.messageId, (b) => {
        const r = appendText(b, stream.textIndex, text);
        stream.textIndex = r.index;
        return r.blocks;
      });
    },
    [appendBlocks],
  );

  /**
   * 在消息末尾插入非文本块（动作 / 提示 / 错误）。
   *
   * 插入前先排空缓冲区，否则模型「先说一句再调工具」时动作卡片会排到
   * 那句话**前面**。插入后还要把 `textIndex` 推到新块之后——后续正文必须
   * 写在它后面，否则打字机会把新文字合并到动作卡片前面。
   */
  const insertTailBlock = useCallback(
    (stream: StreamTarget, block: Block) => {
      flushBuffer();
      appendBlocks(stream.sessionId, stream.messageId, (b) => {
        // 新块落在 b.length，下一个 text 块的位置就是 b.length + 1
        stream.textIndex = b.length + 1;
        return [...b, block];
      });
    },
    [appendBlocks, flushBuffer],
  );

  useEffect(() => {
    let disposed = false;
    const unsubs: Array<() => void> = [];

    // 泛型化而非写死 payload：新事件（如 todo_plan）携带的是 todos 而非
    // text/ok/detail，写死类型就只能改签名或塞进 any
    const on = async <T,>(name: string, cb: (payload: T) => void) => {
      const un = await listen<T>(name, (e) => cb(e.payload));
      if (disposed) un();
      else unsubs.push(un);
    };

    on<{ session_id: string; text?: string }>("agent:chunk", (p) => {
      const stream = streamRef.current;
      if (!stream || stream.sessionId !== p.session_id) return;
      bufferRef.current += p.text ?? "";
    });
    on<{
      session_id: string;
      text?: string;
      ok?: boolean;
      detail?: string;
      duration_ms?: number;
      diff?: { path: string; before: string; after: string };
    }>("agent:action", (p) => {
      const stream = streamRef.current;
      if (!stream || stream.sessionId !== p.session_id) return;
      insertTailBlock(stream, {
        // ok 由后端给出；旧版本事件无此字段时按成功处理
        kind: "action",
        text: p.text ?? "",
        ok: p.ok !== false,
        detail: p.detail || undefined,
        // 耗时同理：旧版本事件没有这个字段，显示为「无」而非 0
        durationMs: p.duration_ms ?? undefined,
        // diff 同理：旧版本事件没有这个字段
        diff: p.diff ?? undefined,
      });
    });
    on<{ session_id: string; text?: string }>("agent:notice", (p) => {
      const stream = streamRef.current;
      if (!stream || stream.sessionId !== p.session_id) return;
      insertTailBlock(stream, { kind: "notice", text: p.text ?? "" });
    });
    on<{ session_id: string; text?: string }>("agent:error", (p) => {
      const stream = streamRef.current;
      if (!stream || stream.sessionId !== p.session_id) return;
      sawErrorRef.current = true;
      insertTailBlock(stream, { kind: "error", text: p.text ?? "" });
    });
    on<{ session_id: string }>("agent:done", (p) => {
      const stream = streamRef.current;
      if (!stream || stream.sessionId !== p.session_id) return;
      // 收尾时可能仍有未消费的正文，先落位再判断是否空消息
      flushBuffer();
      appendBlocks(stream.sessionId, stream.messageId, (b) =>
        b.length === 0 ? [{ kind: "text", text: "" }] : b,
      );
    });

    // 规划模式产出的任务清单。注意这里**不要求** streamRef 匹配：
    // 清单属于会话级状态，即使此刻正在流式输出也应立即反映到面板
    on<{ session_id: string; todos: unknown }>("agent:todo_plan", (p) => {
      setState((s) => ({
        ...s,
        sessions: s.sessions.map((sess) =>
          sess.id === p.session_id
            ? { ...sess, todos: normalizeTodos(p.todos) }
            : sess,
        ),
      }));
    });

    // 单步状态推进。同样不要求 streamRef 匹配，且**不落盘**——
    // 后端已把最终状态写进 todos_json，这里只更新内存用于即时显示，
    // 避免每次勾选都触发一次写放大
    on<{ session_id: string; id: string; status: string }>(
      "agent:todo_update",
      (p) => {
        if (!isTodoStatus(p.status)) return;
        setState((s) => ({
          ...s,
          sessions: s.sessions.map((sess) => {
            if (sess.id !== p.session_id) return sess;
            const next = sess.todos.map((t) =>
              t.id === p.id ? { ...t, status: p.status as TodoStatus } : t,
            );
            // 全部完成后自动清空，任务做完即清场
            return { ...sess, todos: applyAutoClear(next) };
          }),
        }));
      },
    );

    return () => {
      disposed = true;
      unsubs.forEach((u) => u());
    };
  }, [insertTailBlock, flushBuffer]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const buf = bufferRef.current;
      const stream = streamRef.current;
      if (!buf || !stream) return;
      const chars = Array.from(buf);
      const backlog = chars.length;
      // 自适应消费：正常流逐字推进（打字机节奏），
      // 网络突发积压时按时间预算加速，约 0.5s 内追平，避免卡顿滞后
      let n: number;
      if (backlog <= 60) {
        n = backlog > 40 ? 2 : 1;
      } else if (backlog <= 300) {
        n = Math.ceil(backlog / 30);
      } else {
        n = Math.ceil(backlog / 15) + 4;
      }
      n = Math.min(Math.max(n, 1), backlog);
      const take = chars.slice(0, n).join("");
      bufferRef.current = chars.slice(n).join("");
      writeToStream(stream, take);
    }, 30);
    return () => window.clearInterval(timer);
  }, [writeToStream]);

  const drainBuffer = useCallback(async () => {
    const start = Date.now();
    while (bufferRef.current && Date.now() - start < 5000) {
      const stream = streamRef.current;
      if (!stream) break;
      const chars = Array.from(bufferRef.current);
      const n = Math.max(1, Math.ceil(chars.length / 3));
      const take = chars.slice(0, n).join("");
      bufferRef.current = chars.slice(n).join("");
      writeToStream(stream, take);
      await new Promise((r) => setTimeout(r, 30));
    }
    const rest = bufferRef.current;
    bufferRef.current = "";
    const stream = streamRef.current;
    if (rest && stream) {
      writeToStream(stream, rest);
    }
  }, [writeToStream]);

  useEffect(() => {
    Promise.all([getWorkspace(), loadSessions(), getModels(), getSelectedModel()])
      .then(([rawWs, saved, models, selectedModel]) => {
        const ws = normWs(rawWs);
setState((s) => {
   // 过滤历史脏行（工作区为空），避免侧边栏出现空白工作区分组
   const restored: Session[] = saved
        .map((x) => ({
            id: x.id,
    title: x.title,
       workspace: normWs(x.workspace),
            messages: x.messages,
      // 旧版本会话没有 todos 字段，按空清单处理
      todos: normalizeTodos(x.todos),
          }))
       .filter((r) => r.workspace !== "");
          // 侧边栏的工作区来自「有消息的会话」去重。空对话是内存草稿，
          // 不该凭空造出一个工作区分组。
          const listed = listedSessions(restored);
          const workspaces = listed
            .map((r) => r.workspace)
            .filter((w, i, arr) => arr.indexOf(w) === i);
let sessions = restored;
  let activeId = "";
   // workspace 必须跟着实际选中的会话走。`picked` 可能来自
          // restored[0]（上次工作区下已无会话时的回退），此时若仍写回
          // ws，就会出现「激活的会话属于 Y、全局 workspace 却是 X」的错位。
      let activeWs = ws;
  const picked = pickSessionInWorkspace(restored, ws) ?? listed[0];
          if (picked) {
      activeId = picked.id;
            activeWs = picked.workspace;
          }
          if (!sessions.some((x) => x.id === activeId)) {
     // 没有任何历史会话：开一个未定工作区的空对话，等用户在输入框旁选目录
  const ns = createSession();
   sessions = [...sessions, ns];
            activeId = ns.id;
          }
          return {
            ...s,
            workspaces,
            workspace: activeWs,
            sessions,
            activeId,
            models,
            selectedModel,
          };
        });
      })
      .catch(() => {});
  }, []);

  const setModel = useCallback(async (id: string) => {
    try {
      await setSelectedModelApi(id);
      setState((s) => ({ ...s, selectedModel: id }));
    } catch {
      /* 无效模型保持原选择 */
    }
  }, []);

  const setMode = useCallback((m: Mode) => {
    setState((s) => (s.mode === m ? s : { ...s, mode: m }));
  }, []);

  /**
   * 以「乐观更新 + 后端回填」的方式保存清单。
   *
   * 先改本地 state 让面板立刻响应，再落盘；后端会按与模型产出
   * 相同的规则清洗（去空标题、去重复 id），返回清洗结果后再对齐一次，
   * 避免前端与落盘态出现分歧。
   */
  const commitTodos = useCallback(
    async (sessionId: string, todos: Todo[]) => {
      // 自动清空放在这里而不是各调用点：这是清单状态变更的唯一出口，
      // 收在一处才不会漏掉某条路径（模型事件、勾选、新增都要经过）
      const clean = applyAutoClear(normalizeTodos(todos));
      setState((s) => ({
        ...s,
        sessions: s.sessions.map((sess) =>
          sess.id === sessionId ? { ...sess, todos: clean } : sess,
        ),
      }));
      try {
        const saved = await saveTodosApi(sessionId, clean);
        setState((s) => ({
          ...s,
          sessions: s.sessions.map((sess) =>
            sess.id === sessionId
              ? { ...sess, todos: normalizeTodos(saved) }
              : sess,
          ),
        }));
      } catch {
        /* 落盘失败保留内存态，下次操作会重试 */
      }
    },
    [],
  );

  const deleteTodoStep = useCallback(
    (id: string) => {
      const sess = stateRef.current.sessions.find(
        (x) => x.id === stateRef.current.activeId,
      );
      if (!sess) return;
      void commitTodos(sess.id, sess.todos.filter((t) => t.id !== id));
    },
    [commitTodos],
  );

  const addTodoStep = useCallback(
    (title: string) => {
      const sess = stateRef.current.sessions.find(
        (x) => x.id === stateRef.current.activeId,
      );
      const text = title.trim();
      if (!sess || !text) return;
      void commitTodos(sess.id, [
        ...sess.todos,
        { id: nextTodoId(sess.todos), title: text, status: "pending" },
      ]);
    },
    [commitTodos],
  );

  const setTodoStatus = useCallback(
    (id: string, status: TodoStatus) => {
      const sess = stateRef.current.sessions.find(
        (x) => x.id === stateRef.current.activeId,
      );
      if (!sess) return;
      void commitTodos(
        sess.id,
        sess.todos.map((t) => (t.id === id ? { ...t, status } : t)),
      );
    },
    [commitTodos],
  );

  const refreshModels = useCallback(async () => {
    try {
      const [models, selectedModel] = await Promise.all([
        getModels(),
        getSelectedModel(),
      ]);
      setState((s) => ({ ...s, models, selectedModel }));
    } catch {
      /* 刷新失败保持现有列表 */
    }
  }, []);

  const sendMessage = useCallback(
    async (text: string) => {
      if (state.busy) return;
      const sessionId = state.activeId;
      if (!sessionId) return;
      setState((s) => ({ ...s, busy: true }));
      sawErrorRef.current = false;
      bufferRef.current = "";
      const userMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: "user",
        content: text,
      };
      const assistantMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        blocks: [],
        // 重新生成时挂上归档的旧版本（v0.7.0）
        ...(pendingVersionsRef.current
          ? { versions: pendingVersionsRef.current }
          : {}),
      };
      pendingVersionsRef.current = undefined;
      const current = stateRef.current.sessions.find((x) => x.id === sessionId);
      if (!current) {
        setState((s) => ({ ...s, busy: false }));
        return;
      }
      // 没定工作区就不能发：后端拿不到执行目录，工具会落到默认目录去。
      // UI 已禁用发送键，这里是防绕过（快捷键 / 直接调 store）。
      if (!current.workspace) {
        setState((s) => ({ ...s, busy: false }));
        return;
      }
      const title =
        current.title === "新对话" ? deriveTitle(text) : current.title;
      const messages = [...current.messages, userMsg, assistantMsg];
      streamRef.current = { sessionId, messageId: assistantMsg.id, textIndex: 0 };
      setState((s) => ({
        ...s,
        sessions: s.sessions.map((sess) =>
          sess.id !== sessionId
            ? sess
            : { ...sess, title, messages },
        ),
      }));
      persistNow(sessionId, title, current.workspace, messages);
      try {
        await sendMessageApi(sessionId, text, stateRef.current.mode);
      } catch (e) {
        if (!sawErrorRef.current) {
          appendBlocks(sessionId, assistantMsg.id, (b) => [
            ...b,
            { kind: "error", text: String(e) },
          ]);
        }
      } finally {
        await drainBuffer();
        streamRef.current = null;
        setState((s) => ({ ...s, busy: false }));
        await new Promise((r) => setTimeout(r, 0));
        const latest = stateRef.current.sessions.find(
          (x) => x.id === sessionId,
        );
        if (latest) {
          persistNow(sessionId, latest.title, latest.workspace, latest.messages);
        }
        // v0.7.0：系统通知。
        // **只在窗口不在前台时发**——用户正盯着屏幕时弹通知是打扰，
        // 那是桌面软件与网页都能做到的，不构成「桌面感」。
        // 无人值守时它才是唯一反馈渠道。
        if (isWindowInBackground()) {
          const failed = sawErrorRef.current;
          void notifyApi(
            failed ? "Aura 执行失败" : "Aura 已完成",
            failed ? "任务出错，点击查看详情" : summarizeReply(latest?.messages),
          ).catch(() => {
            /* 通知失败不影响主流程 */
          });
        }
      }
    },
    [state.busy, state.activeId, appendBlocks, drainBuffer, persistNow],
  );

  const stop = useCallback(async () => {
    try {
      // 传当前会话：后端据此校验归属，避免停错流
      await stopMessageApi(stateRef.current.activeId);
    } catch {
      /* 停止命令失败时维持现状 */
    }
  }, []);

  /**
   * 回滚到第 userIndex 条用户消息，然后重新发送 `text`。
   *
   * 「重新生成」与「编辑消息并重跑」共用这一条路径：
   * - 重新生成：userIndex = 该回答对应的用户消息序号，text = 原问题
   * - 编辑重跑：userIndex = 被编辑的用户消息序号，text = 新内容
   *
   * 三步缺一不可：
   * 1. **先截断后端历史**——否则模型会看到用户刚删掉的「未来内容」；
   * 2. **再截界面消息**——删掉该用户消息及其后，那条消息由重发取代；
   * 3. **最后重发**——把第 userIndex 条用户消息补回历史。
   *
   * 顺序反了会出问题：先重发再截断会把刚发的消息也截掉。
   */
  const resendFrom = useCallback(
    async (
      userIndex: number,
      text: string,
      options?: { archive?: boolean },
    ) => {
      if (stateRef.current.busy) return;
      const sessionId = stateRef.current.activeId;
      if (!sessionId) return;
      const session = stateRef.current.sessions.find((x) => x.id === sessionId);
      if (!session) return;
      const trimmed = text.trim();
      if (!trimmed) return;

      // 1. 后端历史截断。失败就不继续——否则界面删了、后端没删，
      //    两边对不上，模型仍会看到旧上下文。
      try {
        await truncateHistoryApi(sessionId, keepThroughForResend(userIndex));
      } catch (e) {
        appendBlocks(
          sessionId,
          lastAssistantId(session.messages) ?? "",
          (b) => [...b, { kind: "error", text: `回滚失败：${String(e)}` }],
        );
        return;
      }

      // 2. 界面消息截断
      const kept = sliceForResend(session.messages, userIndex);

      // 3. 重新生成时把被删掉的那条回答归档，供版本切换回看。
      //    「编辑」不归档——那不是同一轮回答的另一个版本。
      let versions: AssistantVersion[] | undefined;
      if (options?.archive) {
        const removed = removedAssistant(session.messages, kept);
        if (removed && removed.role === "assistant") {
          const archived = archiveCurrent(removed);
          if (archived.role === "assistant") versions = archived.versions;
        }
      }
      pendingVersionsRef.current = versions;

      setState((s) => ({
        ...s,
        sessions: s.sessions.map((sess) =>
          sess.id !== sessionId ? sess : { ...sess, messages: kept },
        ),
      }));
      persistNow(sessionId, session.title, session.workspace, kept);

      // 4. 重新发送
      setEditingUserIndex(null);
      await sendMessage(trimmed);
    },
    [appendBlocks, persistNow, sendMessage],
  );

  /**
   * 切换某条 assistant 消息显示的版本。
   *
   * 只改显示，不动后端上下文——见 lib/versions.ts 的说明。
   */
  const switchMessageVersion = useCallback(
    (messageId: string, index: number) => {
      const sessionId = stateRef.current.activeId;
      if (!sessionId) return;
      const session = stateRef.current.sessions.find((x) => x.id === sessionId);
      if (!session) return;
      let changed = false;
      const messages = session.messages.map((m) => {
        if (m.id !== messageId) return m;
        const next = switchVersion(m, index);
        if (next !== m) changed = true;
        return next;
      });
      if (!changed) return;
      setState((s) => ({
        ...s,
        sessions: s.sessions.map((sess) =>
          sess.id !== sessionId ? sess : { ...sess, messages },
        ),
      }));
      persistNow(sessionId, session.title, session.workspace, messages);
    },
    [persistNow],
  );

  /**
   * 提交输入框内容。处于编辑状态时走「回滚 + 重发」，
   * 否则是普通发送。输入框只认这一个入口。
   */
  const submitMessage = useCallback(
    async (text: string) => {
      const idx = editingUserIndexRef.current;
      if (idx === null) {
        await sendMessage(text);
        return;
      }
      await resendFrom(idx, text);
    },
    [sendMessage, resendFrom],
  );

  /** 进入编辑状态：原文放回输入框 */
  const beginEdit = useCallback((userIndex: number, text: string) => {
    setEditingUserIndex(userIndex);
    setEditPrefill(text);
  }, []);

  const cancelEdit = useCallback(() => {
    setEditingUserIndex(null);
    setEditPrefill(null);
  }, []);

  /** 往输入框插入一段文本（拖放文件路径时用） */
  const insertIntoInput = useCallback((text: string) => {
    insertSeq.current += 1;
    setInputInsert({ text, id: insertSeq.current });
  }, []);

/**
   * 切到某个已有工作区的最近一个对话。
   *
   * 侧边栏列出的工作区必然有已落库的会话，所以这里只会「找到」而不会
   * 「新建」——工作区列表本身只从有消息的会话派生，不靠这个函数维护。
   */
  const switchWorkspace = useCallback(async (path: string) => {
    const canonical = await setWorkspace(path);
    setState((s) => {
      let activeId = s.activeId;
      const active = s.sessions.find((x) => x.id === activeId);
      if (!active || active.workspace !== canonical) {
    const picked = pickSessionInWorkspace(s.sessions, canonical);
        if (picked) activeId = picked.id;
   }
      return { ...s, workspace: canonical, activeId };
    });
  }, []);

  /** 新建空对话。工作区留空，等用户在输入框旁选目录后再定。 */
  const newSession = useCallback(async () => {
    setState((s) => {
   // 复用当前那个还没发过消息的空对话，避免连点几次堆出多个草稿
  const draft = s.sessions.find((x) => x.messages.length === 0);
      if (draft) return { ...s, activeId: draft.id };
 const ns = createSession();
      return { ...s, sessions: [...s.sessions, ns], activeId: ns.id };
    });
  }, []);

  /**
   * 给当前对话指定工作区目录。
   *
   * 选中即调用 `setWorkspace`，让全局值与 `last_workspace` 跟着走——后端对
   * 尚未落库的会话要走全局回落分支取执行目录，两者必须一致。
   *
   * v0.6.0：首条消息发出后工作区**锁定**——一个对话唯一对应一个工作区。
   * UI 已隐藏选择器，这里挡程序化调用（快捷键/直接调 store）绕过。
   */
  const setSessionWorkspace = useCallback(async (path: string) => {
    const active = stateRef.current.sessions.find(
      (x) => x.id === stateRef.current.activeId,
    );
    if (!active || active.messages.length > 0) return;
    const canonical = await setWorkspace(path);
    setState((s) => {
      const sessions = s.sessions.map((x) =>
        x.id === active.id ? { ...x, workspace: canonical } : x,
      );
      return {
        ...s,
        workspace: canonical,
        sessions,
        // 选完工作区后该会话就归类显示了（即便还没发消息），
        // 与「发第一条消息才出现」略有出入，但能避免用户不知道自己选到哪了
        workspaces: listedSessions(sessions)
          .map((x) => x.workspace)
          .filter((w, i, arr) => arr.indexOf(w) === i),
      };
    });
  }, []);

  const selectSession = useCallback((id: string) => {
    setState((s) => ({ ...s, activeId: id }));
  }, []);

  const openSession = useCallback(async (id: string) => {
    const sess = stateRef.current.sessions.find((x) => x.id === id);
    if (!sess) return;
    if (sess.workspace !== stateRef.current.workspace) {
      try {
        await setWorkspace(sess.workspace);
      } catch {
        return;
      }
    }
    setState((s) => ({ ...s, workspace: sess.workspace, activeId: id }));
  }, []);

const deleteSession = useCallback((id: string) => {
    removeSession(id).catch(() => {});
setState((s) => {
      let sessions = s.sessions.filter((x) => x.id !== id);
      let activeId = s.activeId;
      if (activeId === id) {
        const picked = pickSessionInWorkspace(sessions, s.workspace);
        if (picked) {
          activeId = picked.id;
        } else {
        // 该工作区没别的对话了：开一个未定工作区的空对话，
    // 否则 activeId 悬空，输入框会失去上下文
     const ns = createSession();
          sessions = [...sessions, ns];
          activeId = ns.id;
     }
      }
      return {
        ...s,
        sessions,
      activeId,
        // 删掉的可能正是某工作区最后一个会话，那个分组要一起消失
    workspaces: listedSessions(sessions)
        .map((x) => x.workspace)
      .filter((w, i, arr) => arr.indexOf(w) === i),
      };
    });
  }, []);

  const removeWorkspace = useCallback(async (path: string) => {
    const s0 = stateRef.current;
    if (path === s0.workspace) return;
    const ids = s0.sessions.filter((x) => x.workspace === path).map((x) => x.id);
    removeWorkspaceApi(path, ids).catch(() => {});
    setState((s) => ({
      ...s,
      workspaces: s.workspaces.filter((w) => w !== path),
      sessions: s.sessions.filter((x) => x.workspace !== path),
    }));
  }, []);

  const value = useMemo<StoreValue>(
    () => ({
      ...state,
      activeSession: state.sessions.find((x) => x.id === state.activeId),
      renamingId,
      startRename,
      cancelRename,
      renameSession,
      sendMessage,
      resendFrom,
      switchMessageVersion,
      editingUserIndex,
      editPrefill,
      inputInsert,
      insertIntoInput,
      beginEdit,
      cancelEdit,
      submitMessage,
      stop,
      switchWorkspace,
      newSession,
      setSessionWorkspace,
      selectSession,
      openSession,
      deleteSession,
      removeWorkspace,
      setModel,
      setMode,
      deleteTodoStep,
      addTodoStep,
      setTodoStatus,
      refreshModels,
    }),
    [
      state,
      renamingId,
      startRename,
      cancelRename,
      renameSession,
      sendMessage,
      resendFrom,
      switchMessageVersion,
      editingUserIndex,
      editPrefill,
      inputInsert,
      insertIntoInput,
      beginEdit,
      cancelEdit,
      submitMessage,
      stop,
      switchWorkspace,
    newSession,
      setSessionWorkspace,
      selectSession,
      openSession,
      deleteSession,
      removeWorkspace,
      setModel,
      setMode,
      deleteTodoStep,
      addTodoStep,
      setTodoStatus,
      refreshModels,
    ],
  );

  return (
    <StoreContext.Provider value={value}>{children}</StoreContext.Provider>
  );
}

export function useStore(): StoreValue {
  const value = useContext(StoreContext);
  if (!value) {
    throw new Error("useStore 必须在 StoreProvider 内使用");
  }
  return value;
}
