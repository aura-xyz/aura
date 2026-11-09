/**
 * 终端会话注册表（v0.8.0）。
 *
 * 终端进程活在 Rust 侧，前端只持有「视图」。这里维护
 * 「终端 id → 会话」的映射，让**会话状态与 React 组件解耦**：
 *
 * - 切走标签页 / 收起右栏 → 组件卸载，但进程继续跑，输出攒进回放缓冲；
 * - 重新打开 → 组件重建 xterm，把缓冲回放进去，屏幕恢复；
 * - 关闭标签页 → 显式 `disposeTerminalSession` 才结束进程。
 *
 * 「关闭标签」不能做在组件的卸载回调里：收起右栏也会卸载组件，
 * 那样一折叠就把 shell 杀了。
 *
 * 缓冲同时承担**重连恢复**的职责：xterm 是有状态的终端模拟器，
 * 把 ANSI 序列重放一遍就能还原屏幕，所以不必另做屏幕快照。
 */
import {
  closeTerminal,
  createTerminal,
  onTerminalExit,
  onTerminalOutput,
  resizeTerminal,
  writeTerminal,
  type TerminalInfo,
} from "./terminal";

/** 终端会话状态。 */
export type TerminalStatus = "starting" | "running" | "exited" | "failed";

/** 输出接收端。xterm 实例实现它即可。 */
export interface TerminalSink {
  write(data: string): void;
}

/** 回放缓冲上限（字符）。超了从**头部**截断——尾部才是最新的。 */
const MAX_BACKLOG = 512 * 1024;

type Watcher = (session: TerminalSession) => void;

/** 一个终端会话。 */
export class TerminalSession {
  readonly id: string;
  status: TerminalStatus = "starting";
  info?: TerminalInfo;
  error?: string;
  exitCode: number | null = null;

  private sink: TerminalSink | null = null;
  private backlog = "";
  private readonly watchers = new Set<Watcher>();
  /** 创建中的 promise：并发调用只创建一个进程 */
  creating: Promise<void> | null = null;

  constructor(id: string) {
    this.id = id;
  }

  /** 订阅状态变化。回调会立即收到一次当前状态。 */
  watch(watcher: Watcher): () => void {
    this.watchers.add(watcher);
    watcher(this);
    return () => {
      this.watchers.delete(watcher);
    };
  }

  /** 通知所有订阅者状态变了。 */
  notify(): void {
    for (const watcher of this.watchers) watcher(this);
  }

  /** 收到后端输出：进缓冲 + 送给当前挂着的接收端。 */
  feed(data: string): void {
    this.backlog += data;
    if (this.backlog.length > MAX_BACKLOG) {
      this.backlog = this.backlog.slice(-MAX_BACKLOG);
    }
    this.sink?.write(data);
  }

  /**
   * 挂上接收端，并把缓冲回放进去。
   *
   * 回放是「重建屏幕」的关键：组件每次挂载都新建 xterm，
   * 只有把此前的 ANSI 序列重放一遍，屏幕才跟关闭前一样。
   */
  attach(sink: TerminalSink): void {
    this.sink = sink;
    if (this.backlog) sink.write(this.backlog);
  }

  /** 摘掉接收端。之后的输出只进缓冲。 */
  detach(): void {
    this.sink = null;
  }

  /** 是否已有结果（可用于避免重复创建）。 */
  get settled(): boolean {
    return this.status === "running" || this.status === "exited" || this.status === "failed";
  }
}

const sessions = new Map<string, TerminalSession>();
let eventsReady: Promise<void> | null = null;

function errorText(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  return String(error);
}

/** 只装一次事件监听。所有终端共用。 */
function ensureEvents(): Promise<void> {
  if (eventsReady) return eventsReady;
  eventsReady = Promise.all([
    onTerminalOutput((payload) => {
      sessions.get(payload.id)?.feed(payload.data);
    }),
    onTerminalExit((payload) => {
      const session = sessions.get(payload.id);
      if (!session) return;
      session.status = "exited";
      session.exitCode = payload.code;
      session.notify();
    }),
  ])
    .then(() => undefined)
    .catch((error) => {
      // 监听装不上就别缓存失败，下次还能重试
      eventsReady = null;
      throw error;
    });
  return eventsReady;
}

/** 取会话（不存在时返回 undefined）。 */
export function getTerminalSession(id: string): TerminalSession | undefined {
  return sessions.get(id);
}

/** 订阅会话状态。 */
export function watchTerminalSession(
  id: string,
  watcher: Watcher,
): () => void {
  const session = sessions.get(id);
  if (!session) return () => undefined;
  return session.watch(watcher);
}

/**
 * 确保终端进程已启动。
 *
 * 幂等：同一个 id 反复调用只创建一个进程（组件重挂载时不会开出第二个 shell）。
 */
export async function ensureTerminalSession(options: {
  id: string;
  sessionId: string;
  shellPath?: string;
}): Promise<TerminalSession> {
  let session = sessions.get(options.id);
  if (!session) {
    session = new TerminalSession(options.id);
    sessions.set(options.id, session);
  }
  if (session.settled) return session;
  if (!session.creating) {
    session.creating = (async () => {
      try {
        await ensureEvents();
        const info = await createTerminal({
          id: options.id,
          sessionId: options.sessionId,
          shellPath: options.shellPath,
          cols: 80,
          rows: 24,
        });
        session!.info = info;
        session!.status = "running";
      } catch (error) {
        session!.status = "failed";
        session!.error = errorText(error);
      }
      session!.notify();
    })();
  }
  await session.creating;
  return session;
}

/** 挂上 xterm 接收端。 */
export function attachTerminalSink(id: string, sink: TerminalSink): void {
  sessions.get(id)?.attach(sink);
}

/** 摘掉 xterm 接收端。 */
export function detachTerminalSink(id: string): void {
  sessions.get(id)?.detach();
}

/** 投递输入。会话已不存在时静默忽略。 */
export async function sendTerminalInput(
  id: string,
  data: string,
): Promise<void> {
  const session = sessions.get(id);
  if (!session || session.status !== "running") return;
  try {
    await writeTerminal(id, data);
  } catch {
    // 进程刚退出时写入会失败，忽略即可
  }
}

/** 调整尺寸。会话已不存在时静默忽略。 */
export async function resizeTerminalSession(
  id: string,
  cols: number,
  rows: number,
): Promise<void> {
  const session = sessions.get(id);
  if (!session || session.status !== "running") return;
  try {
    await resizeTerminal(id, cols, rows);
  } catch {
    // 同上
  }
}

/**
 * 关闭终端：结束进程并从注册表移除。
 *
 * **只在「用户关闭标签页」时调用**——组件卸载（收起右栏、切走标签）
 * 不能走这里，否则一折叠就把 shell 杀了。
 */
export async function disposeTerminalSession(id: string): Promise<void> {
  const session = sessions.get(id);
  sessions.delete(id);
  session?.detach();
  try {
    await closeTerminal(id);
  } catch {
    // 进程已经自己退出了，关不掉也无所谓
  }
}

/** 仅供测试：清空注册表。 */
export function __resetTerminalSessions(): void {
  sessions.clear();
  eventsReady = null;
}
