import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { __resetTerminalSessions } from "../lib/terminalSessions";

/**
 * xterm 在 jsdom 里跑不起来（要 canvas 与真实排版测量），
 * 所以这里替换成一个记录写入内容的桩。测的是**组件与终端会话的接线**，
 * 不是 xterm 本身。
 */
const written: string[] = [];
let dataHandler: ((data: string) => void) | null = null;

vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    cols = 80;
    rows = 24;
    constructor(public options: unknown) {}
    loadAddon() {}
    open() {}
    onData(cb: (data: string) => void) {
      dataHandler = cb;
      return { dispose: () => {} };
    }
    write(data: string) {
      written.push(data);
    }
    dispose() {}
  },
}));

vi.mock("@xterm/addon-fit", () => ({
  FitAddon: class {
    fit() {}
    proposeDimensions() {
      return { cols: 80, rows: 24 };
    }
  },
}));

const writeTerminal = vi.fn(async () => {});
const resizeTerminal = vi.fn(async () => {});
const closeTerminal = vi.fn(async () => {});
const createTerminal = vi.fn(async (options: { id: string }) => ({
  id: options.id,
  shell_path: "C:\\Windows\\System32\\cmd.exe",
  shell_name: "cmd.exe",
  shell_kind: "cmd",
  cwd: "C:\\work",
  cols: 80,
  rows: 24,
  pid: 1234,
}));

vi.mock("../lib/terminal", () => ({
  createTerminal: (...args: unknown[]) => createTerminal(...(args as [])),
  writeTerminal: (...args: unknown[]) => writeTerminal(...(args as [])),
  resizeTerminal: (...args: unknown[]) => resizeTerminal(...(args as [])),
  closeTerminal: (...args: unknown[]) => closeTerminal(...(args as [])),
  onTerminalOutput: vi.fn(async () => () => {}),
  onTerminalExit: vi.fn(async () => () => {}),
}));

async function mount() {
  const { TerminalPanel } = await import("./TerminalPanel");
  render(<TerminalPanel sessionId="s1" terminalId="term1" />);
}

beforeEach(() => {
  written.length = 0;
  dataHandler = null;
  writeTerminal.mockClear();
  resizeTerminal.mockClear();
  closeTerminal.mockClear();
  createTerminal.mockClear();
  localStorage.clear();
  // 会话注册表是模块级状态，跨用例残留会让「幂等创建」看起来像没创建
  __resetTerminalSessions();
  // jsdom 里所有元素的 clientWidth/Height 都是 0，终端面板会认为容器
  // 不可见而跳过 fit。给一个固定尺寸，让「有尺寸才同步行列数」这条能走通。
  Object.defineProperty(HTMLElement.prototype, "clientWidth", {
    configurable: true,
    value: 800,
  });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    value: 600,
  });
});

describe("终端面板", () => {
  it("挂载后创建终端进程", async () => {
    await mount();
    await waitFor(() => expect(createTerminal).toHaveBeenCalled());
    expect(createTerminal.mock.calls[0][0]).toMatchObject({
      id: "term1",
      sessionId: "s1",
    });
  });

  it("启动期间显示提示，成功后消失", async () => {
    await mount();
    expect(screen.getByText("正在启动终端…")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByText("正在启动终端…")).not.toBeInTheDocument(),
    );
  });

  it("用户输入被送到后端", async () => {
    await mount();
    await waitFor(() => expect(dataHandler).not.toBeNull());
    dataHandler?.("ls -la\r");
    expect(writeTerminal).toHaveBeenCalledWith("term1", "ls -la\r");
  });

  it("容器有尺寸时把行列数同步给后端", async () => {
    await mount();
    await waitFor(() => expect(resizeTerminal).toHaveBeenCalled());
    expect(resizeTerminal.mock.calls[0]).toEqual(["term1", 80, 24]);
  });

  it("卸载组件不结束进程（收起右栏不该杀掉 shell）", async () => {
    const { TerminalPanel } = await import("./TerminalPanel");
    const { unmount } = render(
      <TerminalPanel sessionId="s1" terminalId="term1" />,
    );
    await waitFor(() => expect(createTerminal).toHaveBeenCalled());
    unmount();
    expect(closeTerminal).not.toHaveBeenCalled();
  });
});
