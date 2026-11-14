import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  History,
  MessageSquarePlus,
  Plug,
  Sparkles,
} from "lucide-react";

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

const DEFAULT_NAV_BLOCKS = [
  { id: "new", label: "新建对话", icon: MessageSquarePlus, onClick: vi.fn() },
  { id: "skills", label: "Skills", icon: Sparkles, onClick: vi.fn() },
  { id: "mcp", label: "MCP", icon: Plug, onClick: vi.fn() },
  { id: "timeline", label: "轨迹", icon: History, onClick: vi.fn() },
];

/**
 * Sidebar 依赖 store，这里 mock 掉 useStore 而不是渲染真实 Provider。
 * 真实 Provider 会拉起 Tauri 的 invoke/listen，在单测里没有意义。
 */
async function mount(
  props: Partial<Record<string, unknown>> = {},
  storeOverrides: Partial<Record<string, unknown>> = {},
) {
  const store = {
    workspaces: WORKSPACES,
    workspace: "E:/dev/aura",
    sessions: SESSIONS,
    activeId: "s1",
    switchWorkspace: vi.fn(),
    newSession: vi.fn(),
    openSession: vi.fn(),
    deleteSession: vi.fn(),
    renamingId: null,
    cancelRename: vi.fn(),
    renameSession: vi.fn(),
    ...storeOverrides,
  };
  vi.doMock("../store", () => ({ useStore: () => store }));
  const navBlocks = (props.navBlocks as typeof DEFAULT_NAV_BLOCKS) ?? DEFAULT_NAV_BLOCKS;
  const { default: Sidebar } = await import("./Sidebar");
  return {
    store,
    ...render(
      <Sidebar
        view="chat"
        navBlocks={navBlocks}
        onOpenSettings={vi.fn()}
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

  it("导航项按新建对话 / Skills / MCP / 轨迹 的顺序渲染", async () => {
    await mount();
    const nav = screen.getByRole("navigation");
    // 每个导航项里还有一条 2px 竖线占位 span（无文字），按文字过滤掉
    const labels = Array.from(nav.querySelectorAll("span"))
      .map((s) => s.textContent)
      .filter((t) => t);
    expect(labels).toEqual(["新建对话", "Skills", "MCP", "轨迹"]);
  });

  it("点击导航项触发对应回调", async () => {
    const onSkills = vi.fn();
    const onMcp = vi.fn();
    const onTimeline = vi.fn();
    const blocks = [
      { id: "new", label: "新建对话", icon: MessageSquarePlus, onClick: vi.fn() },
      { id: "skills", label: "Skills", icon: Sparkles, onClick: onSkills },
      { id: "mcp", label: "MCP", icon: Plug, onClick: onMcp },
      { id: "timeline", label: "轨迹", icon: History, onClick: onTimeline },
    ];
    await mount({ navBlocks: blocks });
    await userEvent.click(screen.getByText("Skills"));
    await userEvent.click(screen.getByText("MCP"));
    await userEvent.click(screen.getByText("轨迹"));
    expect(onSkills).toHaveBeenCalledTimes(1);
    expect(onMcp).toHaveBeenCalledTimes(1);
    expect(onTimeline).toHaveBeenCalledTimes(1);
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

  /// 折叠时退出所有分组，只剩一枚工作区入口——此时没有「工作区行」可点，
  /// 切换要经浮层。
  it("折叠态经浮层切换工作区", async () => {
    localStorage.setItem("aura-sidebar-collapsed", "1");
    const { store } = await mount();
    await userEvent.click(screen.getByRole("button", { name: /工作区/ }));
    await userEvent.click(screen.getByRole("menuitem", { name: /other/ }));
    expect(store.switchWorkspace).toHaveBeenCalledWith("E:/dev/other");
  });

  it("折叠态只渲染一枚工作区入口，不渲染会话列表", async () => {
    localStorage.setItem("aura-sidebar-collapsed", "1");
    await mount();
    expect(screen.queryByText("修 bug")).toBeNull();
    // 分组里另一个工作区不能直接出现在折叠态里
    expect(screen.queryByRole("button", { name: "E:/dev/other" })).toBeNull();
    expect(screen.getByRole("button", { name: /工作区/ })).toBeInTheDocument();
  });

  it("折叠偏好写入 localStorage", async () => {
    await mount();
    await userEvent.click(screen.getByRole("button", { name: "收起侧边栏" }));
    expect(localStorage.getItem("aura-sidebar-collapsed")).toBe("1");
  });

  /// 折叠后宽度必须有过渡类，否则 DOM 虽然合并了，动画还是不出现。
  it("侧边栏宽度带过渡动画", async () => {
    const { container } = await mount();
    const aside = container.querySelector("aside");
    expect(aside?.className).toContain("transition-[width]");
    expect(aside?.className).toContain("w-64");
    await userEvent.click(screen.getByRole("button", { name: "收起侧边栏" }));
    expect(aside?.className).toContain("w-14");
  });

  /// 两态共用 chrome 灰底，靠右侧 1px 细线区分主内容区；折叠态不再有
  /// 悬浮卡片的外框、圆角、阴影与外边距（用户拍板该形态退役）。
  it("两态共用灰底与右侧细线，折叠态不再有外框阴影", async () => {
    const { container } = await mount();
    const aside = container.querySelector("aside");
    expect(aside?.className).toContain("bg-chrome");
    expect(aside?.className).toContain("border-r");
    expect(aside?.className).toContain("border-line");
    await userEvent.click(screen.getByRole("button", { name: "收起侧边栏" }));
    const cls = aside?.className ?? "";
    expect(cls).toContain("bg-chrome");
    expect(cls).toContain("border-r");
    expect(cls).not.toContain("rounded-card");
    expect(cls).not.toContain("shadow-sm");
    expect(cls).not.toContain("m-2");
  });

  it("不再使用会瞬间清空内容的旧折叠动画", async () => {
    const { container } = await mount();
    await userEvent.click(screen.getByRole("button", { name: "收起侧边栏" }));
    const names = container.querySelector("aside")?.className ?? "";
    expect(names).not.toContain("fading");
    expect(names).not.toContain("railIn");
  });

  /// 实测反馈：删除是唯一不可撤销的动作，误触一下整个对话就没了。
  /// 点删除按钮只能弹确认，真正落库必须再点一次「删除」。
  describe("删除会话二次确认", () => {
    it("点删除按钮不立即删除，先弹确认框并点名会话", async () => {
      const { store } = await mount();
      await userEvent.click(screen.getAllByRole("button", { name: /删除对话/ })[0]);
      expect(store.deleteSession).not.toHaveBeenCalled();
      expect(screen.getByRole("dialog", { name: "删除对话？" })).toBeInTheDocument();
      expect(screen.getByRole("dialog").textContent).toContain("修 bug");
    });

    it("取消后不删除且关闭确认框", async () => {
      const { store } = await mount();
      await userEvent.click(screen.getAllByRole("button", { name: /删除对话/ })[0]);
      await userEvent.click(screen.getByRole("button", { name: "取消" }));
      expect(store.deleteSession).not.toHaveBeenCalled();
      expect(screen.queryByRole("dialog")).toBeNull();
    });

    it("确认后才删除对应会话", async () => {
      const { store } = await mount();
      await userEvent.click(screen.getAllByRole("button", { name: /删除对话/ })[0]);
      await userEvent.click(screen.getByRole("button", { name: "删除" }));
      expect(store.deleteSession).toHaveBeenCalledWith("s1");
      expect(screen.queryByRole("dialog")).toBeNull();
    });
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

  /// 折叠后三个图标要真正居中：按钮内容用 justify-center，并**连 gap 与左右
  /// 内边距一起去掉**。文字虽 max-w-0 宽度为 0，但 gap 仍占满 10px，
  /// 会把图标连同那段空白一起左推——只断言 px-0 抓不到这个偏差。
  it("折叠态导航图标居中", async () => {
    localStorage.setItem("aura-sidebar-collapsed", "1");
    const { container } = await mount();
    const btns = Array.from(container.querySelectorAll("nav button"));
    expect(btns).toHaveLength(4);
    for (const b of btns) {
      expect(b.className).toContain("justify-center");
      expect(b.className).toContain("gap-0");
      expect(b.className).toContain("px-0");
    }
  });

  /// 设置按钮与导航项同构，同样要居中
  it("折叠态设置按钮也居中", async () => {
    localStorage.setItem("aura-sidebar-collapsed", "1");
    const { container } = await mount();
    const btn = container.querySelector("footer button");
    expect(btn?.className).toContain("justify-center");
    expect(btn?.className).toContain("gap-0");
    expect(btn?.className).toContain("px-0");
  });

  /// 折叠时列表 DOM 瞬间从分组切到圆点（变短），设置按钮必须靠 mt-auto
  /// 钉在容器底边，随 min-height 过渡一起上升；没有这个自动边距，按钮会
  /// 先跳到圆点下方、下边缘才慢慢追上来。静态两态无自由空间，不受影响。
  it("设置按钮带 mt-auto，折叠时跟随下边缘上升", async () => {
    const { container } = await mount();
    const footer = container.querySelector("footer");
    expect(footer?.className).toContain("mt-auto");
  });

  it("点新建对话交给外部处理，不自己弹目录选择器", async () => {
    const onNew = vi.fn();
    const blocks = [
      { id: "new", label: "新建对话", icon: MessageSquarePlus, onClick: onNew },
      { id: "skills", label: "Skills", icon: Sparkles, onClick: vi.fn() },
      { id: "mcp", label: "MCP", icon: Plug, onClick: vi.fn() },
      { id: "timeline", label: "轨迹", icon: History, onClick: vi.fn() },
    ];
    await mount({ navBlocks: blocks });
    await userEvent.click(screen.getByText("新建对话"));
    expect(onNew).toHaveBeenCalledTimes(1);
  });

  /// 面板类导航项（文件 / 网页）由 activePanel 决定高亮，而不看 view。
  it("面板类导航项按 activePanel 高亮", async () => {
    const blocks = [
      { id: "new", label: "新建对话", icon: MessageSquarePlus, onClick: vi.fn() },
      { id: "files", label: "文件", icon: Plug, onClick: vi.fn(), panel: "files" },
      { id: "web", label: "网页", icon: Sparkles, onClick: vi.fn(), panel: "web" },
    ];
    await mount({ navBlocks: blocks, activePanel: "files" });
    expect(screen.getByText("文件").closest("button")).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByText("网页").closest("button")).not.toHaveAttribute(
      "aria-current",
    );
  });

  /// 点击面板类导航项走它自己的 onClick（由 App 负责打开对应右侧面板）。
  it("点击面板类导航项触发其 onClick", async () => {
    const onFiles = vi.fn();
    const blocks = [
      { id: "new", label: "新建对话", icon: MessageSquarePlus, onClick: vi.fn() },
      { id: "files", label: "文件", icon: Plug, onClick: onFiles, panel: "files" },
    ];
    await mount({ navBlocks: blocks });
    await userEvent.click(screen.getByText("文件"));
    expect(onFiles).toHaveBeenCalledTimes(1);
  });

  /// 选中态是「激活态锚点」：v0.6.3 把侧边栏选中会话项从灰底改为品牌蓝浅底
  /// 加左侧品牌色竖线，与页签激活线同源。此前选中与未选中的唯一区别是
  /// 深浅不同的灰，导航当前位置不可读。
  it("当前会话用品牌蓝浅底加竖线标出，未选中项不带", async () => {
    const { container } = await mount();
    const current = container.querySelector('[data-ctx-session="s1"]');
    const other = container.querySelector('[data-ctx-session="s2"]');

    expect(current?.className).toContain("bg-bubble-user");
    expect(other?.className).not.toContain("bg-bubble-user");

    // 竖线是纯装饰，不能进无障碍树
    const bar = current?.querySelector("span");
    expect(bar?.className).toContain("bg-brand");
    expect(bar?.getAttribute("aria-hidden")).toBe("true");
  });

  /// C14：导航项与会话项共用一套选中语言（浅底 + 2px 品牌竖线），
  /// 竖线常驻占位只换颜色，否则激活瞬间图标会横移。
  it("导航项激活时用浅底加品牌竖线", async () => {
    const blocks = DEFAULT_NAV_BLOCKS.map((b) => ({ ...b, panel: b.id }));
    await mount({ activePanel: "mcp", navBlocks: blocks });
    const mcp = screen.getByRole("button", { name: "MCP" });
    expect(mcp).toHaveAttribute("aria-current", "page");
    expect(mcp.className).toContain("bg-bubble-user");
    expect(mcp.querySelector("span.bg-brand")).not.toBeNull();

    const skills = screen.getByRole("button", { name: "Skills" });
    expect(skills).not.toHaveAttribute("aria-current");
    expect(skills.querySelector("span.bg-brand")).toBeNull();
    // 未激活也留一条透明竖线，保证横向不位移
    expect(skills.querySelector("span.bg-transparent")).not.toBeNull();
  });

  /// C14：空工作区不能只留一句「暂无对话」——空态要给出口。
  it("当前工作区没有对话时提供新建对话入口", async () => {
    const { store } = await mount({}, { sessions: [] });
    // 两个工作区都是空的，各给一处空态
    expect(await screen.findAllByText("暂无对话")).toHaveLength(2);
    // 导航区也有一个「新建对话」按钮，空态里的那个带加号图标与下划线文字
    const emptyAction = screen
      .getAllByRole("button", { name: /新建对话/ })
      .find((b) => b.textContent?.trim() === "新建对话");
    expect(emptyAction).toBeDefined();
    await userEvent.click(emptyAction!);
    expect(store.newSession).toHaveBeenCalled();
  });

  /// C15 改版：折叠态只留一枚当前工作区首字方块，数字角标与多工作区
  /// 堆叠一并撤掉——56px 塞不下，角标也看不清（用户反馈）。
  it("折叠态工作区入口只有首字方块，无数字角标", async () => {
    localStorage.setItem("aura-sidebar-collapsed", "1");
    await mount();
    const entry = screen.getByRole("button", { name: /工作区/ });
    // 该工作区有 s1/s2 两条真会话——数字不该再出现在入口上
    expect(entry.textContent).toBe("A");
  });

  /// 折叠态收窄导航区与设置区的左右内边距，让 15px 图标在 56px 里居中。
  it("折叠态导航区收窄内边距", async () => {
    localStorage.setItem("aura-sidebar-collapsed", "1");
    const { container } = await mount();
    expect(container.querySelector("nav")?.className).toContain("px-1.5");
    expect(container.querySelector("footer")?.className).toContain("px-1.5");
  });

  /// 折叠态没有文字，Tooltip 必须承担「功能名 + 快捷键」的说明职责；
  /// 键位从可配置键位表下发（App 传 shortcut），不能硬编码。
  it("折叠态图标带「功能名 · 快捷键」提示", async () => {
    localStorage.setItem("aura-sidebar-collapsed", "1");
    const blocks = [
      { id: "new", label: "新建对话", icon: MessageSquarePlus, onClick: vi.fn(), shortcut: "Ctrl+N" },
      { id: "skills", label: "Skills", icon: Sparkles, onClick: vi.fn() },
      { id: "mcp", label: "MCP", icon: Plug, onClick: vi.fn() },
      { id: "timeline", label: "轨迹", icon: History, onClick: vi.fn() },
    ];
    const { container } = await mount({ navBlocks: blocks });
    const btns = Array.from(container.querySelectorAll("nav button"));
    expect(btns[0]?.title).toBe("新建对话 · Ctrl+N");
    // 没有快捷键的项退化为纯功能名
    expect(btns[1]?.title).toBe("Skills");
    // 设置按钮由 Sidebar 自己从键位表读默认键位
    expect(container.querySelector("footer button")?.title).toBe("设置 · Ctrl+,");
  });
});
