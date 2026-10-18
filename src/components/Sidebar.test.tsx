import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  localStorage.clear();
  vi.resetModules();
  vi.doUnmock("../store");
  vi.doUnmock("@tauri-apps/plugin-dialog");
});

const WORKSPACES = ["E:/dev/aura", "E:/dev/other"];
const SESSIONS = [
  { id: "s1", title: "修 bug", workspace: "E:/dev/aura", messages: [{}], todos: [] },
  { id: "s2", title: "写测试", workspace: "E:/dev/aura", messages: [{}], todos: [] },
  { id: "s3", title: "别的组", workspace: "E:/dev/other", messages: [{}], todos: [] },
  // 空对话：内存草稿，不该出现在侧边栏
  { id: "s4", title: "新对话", workspace: "E:/dev/aura", messages: [], todos: [] },
];

/**
 * Sidebar 依赖 store，这里 mock 掉 useStore 而不是渲染真实 Provider。
 * 真实 Provider 会拉起 Tauri 的 invoke/listen，在单测里没有意义。
 */
async function mount(props: Partial<Record<string, unknown>> = {}) {
  const store = {
    workspaces: WORKSPACES,
    workspace: "E:/dev/aura",
    sessions: SESSIONS,
    activeId: "s1",
    switchWorkspace: vi.fn(),
    openSession: vi.fn(),
    deleteSession: vi.fn(),
    renamingId: null,
    cancelRename: vi.fn(),
    renameSession: vi.fn(),
  };
  vi.doMock("../store", () => ({ useStore: () => store }));
  const { default: Sidebar } = await import("./Sidebar");
  return {
    store,
    ...render(
      <Sidebar
        view="chat"
        onNew={vi.fn()}
        onOpenSettings={vi.fn()}
    onOpenSkills={vi.fn()}
        onOpenMcp={vi.fn()}
        {...props}
      />,
    ),
  };
}

describe("Sidebar", () => {
  it("工作区加载完毕后默认全部展开，各组的对话都能看到", async () => {
    await mount();
    // 归类是这次改造的核心诉求：两个工作区各自的会话都要露出来
    expect(screen.getByText("修 bug")).toBeInTheDocument();
    expect(screen.getByText("写测试")).toBeInTheDocument();
    expect(screen.getByText("别的组")).toBeInTheDocument();
  });

  it("导航项按新建对话 / Skills / MCP 的顺序渲染", async () => {
    await mount();
    const nav = screen.getByRole("navigation");
    const labels = Array.from(nav.querySelectorAll("span")).map((s) => s.textContent);
    expect(labels).toEqual(["新建对话", "Skills", "MCP"]);
  });

  it("点击导航项触发对应回调", async () => {
    const onOpenSkills = vi.fn();
    const onOpenMcp = vi.fn();
    await mount({ onOpenSkills, onOpenMcp });
    await userEvent.click(screen.getByText("Skills"));
    await userEvent.click(screen.getByText("MCP"));
    expect(onOpenSkills).toHaveBeenCalledTimes(1);
    expect(onOpenMcp).toHaveBeenCalledTimes(1);
  });

  /// 当前视图要能高亮，否则用户在 Skills 页看不出自己在哪
  it("当前视图对应的导航项被标记为当前页", async () => {
    await mount({ view: "skills" });
    const item = screen.getByText("Skills").closest("button");
    expect(item).toHaveAttribute("aria-current", "page");
    expect(screen.getByText("MCP").closest("button")).not.toHaveAttribute(
      "aria-current",
    );
  });

  /// 「新建对话」是入口而非页面，永远不该有选中态
  it("新建对话不参与视图高亮", async () => {
    await mount({ view: "chat" });
    expect(screen.getByText("新建对话").closest("button")).not.toHaveAttribute(
      "aria-current",
    );
  });

  it("点会话走 openSession 并切回对话视图", async () => {
    const onNavigate = vi.fn();
    const { store } = await mount({ onNavigate });
    await userEvent.click(screen.getByText("写测试"));
    expect(store.openSession).toHaveBeenCalledWith("s2");
    expect(onNavigate).toHaveBeenCalled();
  });

  /// 工作区行现在只管展开/折叠。若仍切工作区，展开一个组就会顺带激活
  /// 它的某个对话——在「按目录归类」的语义下是意外行为。
  it("点工作区行只展开折叠，不切换工作区", async () => {
    const { store } = await mount();
    await userEvent.click(screen.getByRole("button", { name: "aura" }));
    expect(screen.queryByText("写测试")).toBeNull();
    expect(store.switchWorkspace).not.toHaveBeenCalled();
  });

  /// 折叠时退出所有分组，只剩圆点——此时没有「工作区行」可点
  it("折叠态点圆点走 switchWorkspace", async () => {
    localStorage.setItem("aura-sidebar-collapsed", "1");
    const { store } = await mount();
    await userEvent.click(screen.getByRole("button", { name: "E:/dev/other" }));
    expect(store.switchWorkspace).toHaveBeenCalledWith("E:/dev/other");
  });

  it("折叠态渲染圆点而非分组标题", async () => {
    localStorage.setItem("aura-sidebar-collapsed", "1");
    await mount();
    expect(screen.queryByText("修 bug")).toBeNull();
    expect(screen.queryByText("aura")).toBeNull();
  });

  it("折叠偏好写入 localStorage", async () => {
    await mount();
    await userEvent.click(screen.getByRole("button", { name: "收起侧边栏" }));
    expect(localStorage.getItem("aura-sidebar-collapsed")).toBe("1");
  });

  /// 折叠后宽度必须有过渡类，否则 DOM 虽然合并了，动画还是不出现
  it("侧边栏宽度带过渡动画", async () => {
    const { container } = await mount();
    const aside = container.querySelector("aside");
    expect(aside?.className).toContain("transition-[width]");
    expect(aside?.className).toContain("w-64");
    await userEvent.click(screen.getByRole("button", { name: "收起侧边栏" }));
    expect(aside?.className).toContain("w-14");
  });

  /// 右键菜单靠这两个属性挂载（App.tsx 的 closest 选择器），
/// 合并 DOM 时漏掉任何一个，右键会静默失效
  it("保留右键菜单锚点属性", async () => {
    const { container } = await mount();
    expect(container.querySelector("[data-ctx-workspace]")).toBeInTheDocument();
    // s4 是空对话，不该出现在侧边栏
    expect(container.querySelectorAll("[data-ctx-session]")).toHaveLength(3);
  });

  /// 「发第一条消息才确定工作区、才显示在侧边栏」是这次改造的核心诉求。
/// 空对话即使已绑定目录，也不进列表。
  it("空对话不进侧边栏", async () => {
    await mount();
    expect(screen.queryByText("新对话")).toBeNull();
  });

  /// 折叠态里 56px 放不下「图标+文字」，曾经用卡片边框收窄，
/// 结果图标整体偏移。导航区必须平铺无边框。
  it("导航区不带卡片边框", async () => {
    const { container } = await mount();
    const nav = container.querySelector("nav");
    expect(nav?.className).not.toContain("border");
    expect(nav?.className).not.toContain("bg-surface");
  });

  /// 折叠后三个图标要真正居中：按钮内容用 justify-center 且去掉左右内边距，
  /// 否则文字的 max-w-0 仍会占掉右侧空间，视觉上偏右。
  it("折叠态导航图标居中", async () => {
    localStorage.setItem("aura-sidebar-collapsed", "1");
    const { container } = await mount();
    const btns = Array.from(container.querySelectorAll("nav button"));
    expect(btns).toHaveLength(3);
    for (const b of btns) {
      expect(b.className).toContain("justify-center");
      expect(b.className).toContain("px-0");
    }
  });

  it("点新建对话交给外部处理，不自己弹目录选择器", async () => {
    const onNew = vi.fn();
    await mount({ onNew });
    await userEvent.click(screen.getByText("新建对话"));
    expect(onNew).toHaveBeenCalledTimes(1);
  });
});