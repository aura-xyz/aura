import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 终端会话注册表（v0.8.0）。
 *
 * 测的是「进程活在后端、视图在前端」这条约定的两个关键点：
 * 重新挂载能恢复屏幕（输出回放），以及关闭标签才结束进程。
 */

const outputHandlers: ((payload: { id: string; data: string }) => void)[] = [];
const exitHandlers: ((payload: { id: string; code: number | null }) => void)[] = [];

const createTerminal = vi.fn(async (options: { id: string }) => ({
  id: options.id,
  shell_path: "C:\\Windows\\System32\\cmd.exe",
  shell_name: "cmd.exe",
  shell_kind: "cmd",
  cwd: "C:\\work",
  cols: 80,
  rows: 24,
  pid: 4242,
}));
const closeTerminal = vi.fn(async () => {});
const writeTerminal = vi.fn(async () => {});
const resizeTerminal = vi.fn(async () => {});

vi.mock("./terminal", () => ({
  createTerminal: (...args: unknown[]) => createTerminal(...(args as [])),
  closeTerminal: (...args: unknown[]) => closeTerminal(...(args as [])),
  writeTerminal: (...args: unknown[]) => writeTerminal(...(args as [])),
  resizeTerminal: (...args: unknown[]) => resizeTerminal(...(args as [])),
  onTerminalOutput: vi.fn(async (handler: (p: { id: string; data: string }) => void) => {
    outputHandlers.push(handler);
    return () => {};
  }),
  onTerminalExit: vi.fn(async (handler: (p: { id: string; code: number | null }) => void) => {
    exitHandlers.push(handler);
    return () => {};
  }),
}));

async function fresh() {
  const mod = await import("./terminalSessions");
  mod.__resetTerminalSessions();
  outputHandlers.length = 0;
  exitHandlers.length = 0;
  return mod;
}

beforeEach(() => {
  createTerminal.mockClear();
  closeTerminal.mockClear();
  writeTerminal.mockClear();
  resizeTerminal.mockClear();
  localStorage.clear();
});

describe("终端会话注册表", () => {
  it("同一个 id 反复 ensure 只创建一个进程", async () => {
    const mod = await fresh();
    await mod.ensureTerminalSession({ id: "t1", sessionId: "s1" });
    await mod.ensureTerminalSession({ id: "t1", sessionId: "s1" });
    expect(createTerminal).toHaveBeenCalledTimes(1);
  });

  it("不同的 id 各开一个进程", async () => {
    const mod = await fresh();
    await mod.ensureTerminalSession({ id: "t1", sessionId: "s1" });
    await mod.ensureTerminalSession({ id: "t2", sessionId: "s1" });
    expect(createTerminal).toHaveBeenCalledTimes(2);
  });

  it("挂上接收端后收到输出", async () => {
    const mod = await fresh();
    await mod.ensureTerminalSession({ id: "t1", sessionId: "s1" });
    const received: string[] = [];
    mod.attachTerminalSink("t1", { write: (d) => received.push(d) });
    outputHandlers.forEach((h) => h({ id: "t1", data: "hello" }));
    expect(received).toEqual(["hello"]);
  });

  it("摘掉接收端后输出进缓冲，重新挂载时回放", async () => {
    const mod = await fresh();
    await mod.ensureTerminalSession({ id: "t1", sessionId: "s1" });
    mod.detachTerminalSink("t1");
    outputHandlers.forEach((h) => h({ id: "t1", data: "第一段" }));
    outputHandlers.forEach((h) => h({ id: "t1", data: "第二段" }));

    const received: string[] = [];
    mod.attachTerminalSink("t1", { write: (d) => received.push(d) });
    expect(received.join("")).toBe("第一段第二段");
  });

  it("输出不会发给别的终端", async () => {
    const mod = await fresh();
    await mod.ensureTerminalSession({ id: "t1", sessionId: "s1" });
    await mod.ensureTerminalSession({ id: "t2", sessionId: "s1" });
    const received: string[] = [];
    mod.attachTerminalSink("t2", { write: (d) => received.push(d) });
    outputHandlers.forEach((h) => h({ id: "t1", data: "只给 t1" }));
    expect(received).toEqual([]);
  });

  it("进程退出后状态变为 exited 并带上退出码", async () => {
    const mod = await fresh();
    await mod.ensureTerminalSession({ id: "t1", sessionId: "s1" });
    const seen: string[] = [];
    mod.watchTerminalSession("t1", (s) => seen.push(s.status));
    exitHandlers.forEach((h) => h({ id: "t1", code: 3 }));
    expect(seen).toContain("exited");
    expect(mod.getTerminalSession("t1")?.exitCode).toBe(3);
  });

  it("创建失败时状态为 failed 并带原因", async () => {
    const mod = await fresh();
    createTerminal.mockRejectedValueOnce(new Error("打开伪终端失败"));
    const session = await mod.ensureTerminalSession({
      id: "t1",
      sessionId: "s1",
    });
    expect(session.status).toBe("failed");
    expect(session.error).toContain("伪终端");
  });

  it("关闭会话才结束进程", async () => {
    const mod = await fresh();
    await mod.ensureTerminalSession({ id: "t1", sessionId: "s1" });
    await mod.disposeTerminalSession("t1");
    expect(closeTerminal).toHaveBeenCalledWith("t1");
    expect(mod.getTerminalSession("t1")).toBeUndefined();
  });

  it("会话不存在时写入与 resize 静默忽略", async () => {
    const mod = await fresh();
    await mod.sendTerminalInput("nope", "x");
    await mod.resizeTerminalSession("nope", 80, 24);
    expect(writeTerminal).not.toHaveBeenCalled();
    expect(resizeTerminal).not.toHaveBeenCalled();
  });
});
