import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MessageSquare, MessageSquarePlus } from "lucide-react";
import CommandPalette from "./CommandPalette";
import { recordUse } from "../lib/frecency";
import type { CommandItem } from "../lib/commandItems";

// 最近使用存在 localStorage，用例之间必须清掉，否则排序会互相污染
beforeEach(() => localStorage.clear());

const ITEMS: CommandItem[] = [
  {
    id: "action:new",
    label: "新建对话",
    detail: "",
    icon: MessageSquarePlus,
    group: "action",
  },
  { id: "action:settings", label: "打开设置", detail: "", group: "action" },
  {
    id: "session:s1:-1",
    label: "修登录",
    detail: "3 条消息",
    icon: MessageSquare,
    group: "session",
  },
  { id: "skill:docx", label: "/docx", detail: "处理 Word", group: "skill" },
];

function setup(overrides: Partial<Parameters<typeof CommandPalette>[0]> = {}) {
  const onPick = vi.fn();
  const onClose = vi.fn();
  const utils = render(
    <CommandPalette items={ITEMS} onPick={onPick} onClose={onClose} {...overrides} />,
  );
  return { onPick, onClose, ...utils };
}

describe("CommandPalette", () => {
  /// C27：四类入口收在一个面板里，分组标题固定顺序
  it("按分组渲染，组标题顺序为动作 → 会话 → 技能", () => {
    setup();
    const labels = Array.from(document.querySelectorAll("section > p")).map(
      (p) => p.textContent,
    );
    expect(labels).toEqual(["动作", "会话", "技能"]);
  });

  it("查询为空时按位置标 1–9，数字键直达对应项", () => {
    const { onPick } = setup();
    const input = screen.getByLabelText("搜索命令、会话、技能与文件");

    expect(screen.getByText("3")).toBeInTheDocument();
    fireEvent.keyDown(input, { key: "3" });
    expect(onPick).toHaveBeenCalledWith(ITEMS[2]);
  });

  it("上下键移动高亮，回车执行高亮项", () => {
    const { onPick } = setup();
    const input = screen.getByLabelText("搜索命令、会话、技能与文件");

    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onPick).toHaveBeenCalledWith(ITEMS[1]);
  });

  it("Esc 关闭", () => {
    const { onClose } = setup();
    fireEvent.keyDown(screen.getByLabelText("搜索命令、会话、技能与文件"), {
      key: "Escape",
    });
    expect(onClose).toHaveBeenCalled();
  });

  /// 有查询时不再显示数字键提示——否则会和正常输入的数字抢字符。
  it("输入查询后过滤结果并去掉数字键提示", () => {
    const onQueryChange = vi.fn();
    setup({ onQueryChange });
    const input = screen.getByLabelText("搜索命令、会话、技能与文件");

    fireEvent.change(input, { target: { value: "docx" } });
    expect(onQueryChange).toHaveBeenCalledWith("docx");
    expect(screen.getByText("/docx")).toBeInTheDocument();
    expect(screen.queryByText("新建对话")).toBeNull();
    expect(screen.queryByText("1")).toBeNull();
  });

  it("没有结果时给明确空态", () => {
    setup();
    fireEvent.change(screen.getByLabelText("搜索命令、会话、技能与文件"), {
      target: { value: "zzz" },
    });
    expect(screen.getByText("没有匹配的结果")).toBeInTheDocument();
  });

  /// C31：常用命令在组内自己浮上来，并标「最近」。排序限定组内，
  /// 否则会话项会挤进动作组里。
  it("用过的命令浮到组内最前并标「最近」", () => {
    localStorage.clear();
    recordUse("action:settings", Date.now());
    setup();

    const dialog = screen.getByRole("dialog", { name: "命令面板" });
    const rows = within(dialog).getAllByRole("button");
    expect(rows[0]).toHaveTextContent("打开设置");
    expect(rows[0]).toHaveTextContent("最近");
    // 分组结构不变：动作仍在会话之前
    const labels = Array.from(dialog.querySelectorAll("section > p")).map(
      (p) => p.textContent,
    );
    expect(labels[0]).toBe("动作");
  });

  /// v0.8.2 视觉层级改版：面板加宽到 650px，给右列快捷键/解释文字留位置。
  it("面板最大宽度为 650px", () => {
    const { getByRole } = setup();
    expect(getByRole("dialog", { name: "命令面板" }).className).toContain(
      "max-w-[650px]",
    );
  });

  /// detail（快捷键、解释、消息数）统一推到右列右对齐，全文放进 title：
  /// 长描述截断后悬停仍能看到完整内容。
  it("detail 右对齐截断，悬停展示全文", () => {
    setup();
    const row = screen.getByText("修登录").closest("button")!;
    const detail = row.querySelectorAll("span");
    const tail = detail[detail.length - 1];
    expect(tail.className).toContain("truncate");
    expect(tail.className).toContain("text-right");
    expect(tail.getAttribute("title")).toBe("3 条消息");
  });

  /// 13px 的粗描边 MessageSquare 看着像复选框：会话项加浅底 + 1.5 细描边，
  /// 其它组图标保持默认粗细。
  it("会话图标细描边加浅底，动作图标不变", () => {
    setup();
    const sessionRow = screen.getByText("修登录").closest("button")!;
    expect(sessionRow.querySelector("svg")?.getAttribute("stroke-width")).toBe(
      "1.5",
    );
    expect(sessionRow.innerHTML).toContain("bg-bubble");

    const actionRow = screen.getByText("新建对话").closest("button")!;
    expect(actionRow.querySelector("svg")?.getAttribute("stroke-width")).toBe(
      "2",
    );
  });

  /// 区块标题弱化 + 组间极细分割线：分组信息保留，但保持全局搜索感。
  it("第一组无分割线，后续组有", () => {
    const { container } = setup();
    const sections = container.querySelectorAll("section");
    expect(sections.length).toBeGreaterThan(1);
    expect(sections[0].className).not.toContain("border-t");
    expect(sections[1].className).toContain("border-t");
  });
});
