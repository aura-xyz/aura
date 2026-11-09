import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import CommandPalette from "./CommandPalette";
import type { CommandItem } from "../lib/commandItems";

const ITEMS: CommandItem[] = [
  { id: "action:new", label: "新建对话", detail: "", group: "action" },
  { id: "action:settings", label: "打开设置", detail: "", group: "action" },
  { id: "session:s1:-1", label: "修登录", detail: "3 条消息", group: "session" },
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
});
