import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const listShells = vi.fn(async () => [
  { path: "C:\\Windows\\System32\\cmd.exe", name: "cmd.exe", kind: "cmd", args: [] },
  {
    path: "C:\\Program Files\\PowerShell\\7\\pwsh.exe",
    name: "pwsh.exe",
    kind: "pwsh",
    args: ["-NoLogo"],
  },
]);

vi.mock("../lib/terminal", () => ({
  listShells: (...args: unknown[]) => listShells(...(args as [])),
  preferredShell: () => null,
  rememberShell: vi.fn(),
}));

async function mount(overrides: Partial<React.ComponentProps<typeof import("./SidebarStartPage").default>> = {}) {
  const { default: SidebarStartPage } = await import("./SidebarStartPage");
  const props = {
    onOpenFiles: vi.fn(),
    onOpenWeb: vi.fn(),
    onOpenTerminal: vi.fn(),
    onOpenMore: vi.fn(),
    ...overrides,
  };
  render(<SidebarStartPage {...props} />);
  return props;
}

beforeEach(() => {
  localStorage.clear();
  listShells.mockClear();
});

describe("侧栏开始页", () => {
  it("列出四个入口卡片", async () => {
    await mount();
    expect(screen.getByText("工作区文件")).toBeInTheDocument();
    expect(screen.getByText("新建终端")).toBeInTheDocument();
    expect(screen.getByText("浏览器")).toBeInTheDocument();
    expect(screen.getByText("更多工具")).toBeInTheDocument();
  });

  it("点「工作区文件」打开文件标签", async () => {
    const props = await mount();
    fireEvent.click(screen.getByText("工作区文件"));
    expect(props.onOpenFiles).toHaveBeenCalled();
  });

  it("点「浏览器」打开网页标签", async () => {
    const props = await mount();
    fireEvent.click(screen.getByText("浏览器"));
    expect(props.onOpenWeb).toHaveBeenCalled();
  });

  it("点「新建终端」不指定 shell", async () => {
    const props = await mount();
    fireEvent.click(screen.getByText("新建终端"));
    expect(props.onOpenTerminal).toHaveBeenCalledWith(undefined);
  });

  it("卡片上标注的快捷键与实际绑定一致", async () => {
    await mount();
    expect(screen.getByText("Ctrl + P")).toBeInTheDocument();
    expect(screen.getByText("Ctrl + T")).toBeInTheDocument();
    expect(screen.getByText("Ctrl + `")).toBeInTheDocument();
  });

  it("展开 shell 下拉前不枚举 shell", async () => {
    await mount();
    expect(listShells).not.toHaveBeenCalled();
  });

  it("展开 shell 下拉后列出可用 shell", async () => {
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "选择终端 shell" }));
    await waitFor(() => expect(screen.getByText("cmd.exe")).toBeInTheDocument());
    expect(screen.getByText("pwsh.exe")).toBeInTheDocument();
  });

  it("选中 shell 后用该路径开终端", async () => {
    const props = await mount();
    fireEvent.click(screen.getByRole("button", { name: "选择终端 shell" }));
    await waitFor(() => expect(screen.getByText("pwsh.exe")).toBeInTheDocument());
    fireEvent.click(screen.getByText("pwsh.exe"));
    expect(props.onOpenTerminal).toHaveBeenCalledWith(
      "C:\\Program Files\\PowerShell\\7\\pwsh.exe",
    );
  });

  it("「更多工具」菜单里可选任务与用量", async () => {
    const props = await mount();
    fireEvent.click(screen.getByRole("button", { name: "展开更多工具" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "任务清单" }));
    expect(props.onOpenMore).toHaveBeenCalledWith("todo");
  });
});
