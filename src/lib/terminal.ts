/**
 * 内置终端的前端 API 层（v0.8.0）。
 *
 * 所有与 Tauri 的接触都收在这里——组件与状态机只依赖本文件的纯函数签名，
 * 测试时 mock 掉本模块即可，不必挂起整个应用。
 */
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

/** 一个已确认存在的 shell。 */
export interface ShellProfile {
  path: string;
  name: string;
  kind: string;
  args: string[];
}

/** 终端会话的元信息。 */
export interface TerminalInfo {
  id: string;
  shell_path: string;
  shell_name: string;
  shell_kind: string;
  cwd: string;
  cols: number;
  rows: number;
  pid: number | null;
}

/** 一段终端输出。 */
export interface TerminalOutput {
  id: string;
  data: string;
}

/** 终端进程退出。 */
export interface TerminalExit {
  id: string;
  /** 退出码；被信号杀死时为 null */
  code: number | null;
}

/** 取消事件订阅。 */
export type Unlisten = () => void;

/** 列出本机可用的 shell。 */
export function listShells(): Promise<ShellProfile[]> {
  return invoke<ShellProfile[]>("list_shells");
}

/** 新建终端会话。 */
export function createTerminal(options: {
  id: string;
  sessionId: string;
  shellPath?: string;
  cols: number;
  rows: number;
}): Promise<TerminalInfo> {
  return invoke<TerminalInfo>("terminal_create", {
    id: options.id,
    sessionId: options.sessionId,
    shellPath: options.shellPath,
    cols: options.cols,
    rows: options.rows,
  });
}

/** 投递输入。 */
export function writeTerminal(id: string, data: string): Promise<void> {
  return invoke<void>("terminal_write", { id, data });
}

/** 调整尺寸。 */
export function resizeTerminal(
  id: string,
  cols: number,
  rows: number,
): Promise<void> {
  return invoke<void>("terminal_resize", { id, cols, rows });
}

/** 结束终端进程。 */
export function closeTerminal(id: string): Promise<void> {
  return invoke<void>("terminal_close", { id });
}

/** 订阅输出。 */
export function onTerminalOutput(
  handler: (payload: TerminalOutput) => void,
): Promise<Unlisten> {
  return listen<TerminalOutput>("terminal://output", (event) =>
    handler(event.payload),
  );
}

/** 订阅进程退出。 */
export function onTerminalExit(
  handler: (payload: TerminalExit) => void,
): Promise<Unlisten> {
  return listen<TerminalExit>("terminal://exit", (event) =>
    handler(event.payload),
  );
}

/**
 * 上次选过的 shell。
 *
 * 存**完整路径**而不是 shell 名：路径是后端验证过确实存在的，
 * 下次直接回传，后端再验一次即可。存名字的话，机器上装了同名
 * 但坏掉的解释器就会把终端卡住。
 */
const SHELL_KEY = "aura.terminal.shell";

export function preferredShell(): string | null {
  if (typeof localStorage === "undefined") return null;
  try {
    return localStorage.getItem(SHELL_KEY);
  } catch {
    return null;
  }
}

export function rememberShell(path: string): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(SHELL_KEY, path);
  } catch {
    // 存不下就用默认 shell
  }
}
