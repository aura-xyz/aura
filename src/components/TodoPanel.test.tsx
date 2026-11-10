import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import TodoPanel from "./TodoPanel";
import type { Todo } from "../lib/todo";

beforeEach(() => localStorage.clear());

const TODOS: Todo[] = [
  { id: "1", title: "读代码", status: "done" },
  { id: "2", title: "改接口", status: "in_progress" },
  { id: "3", title: "补测试", status: "pending" },
];

describe("TodoPanel", () => {
  /// C17：只有「x/y」数字看不出还剩多少，加一根 60px 微进度条。
  it("标题行显示进度条与完成比", () => {
    render(<TodoPanel todos={TODOS} />);
    const bar = screen.getByRole("progressbar", { name: "任务进度" });
    expect(bar).toHaveAttribute("aria-valuenow", "33");
    expect(screen.getByText("1/3")).toBeInTheDocument();
  });

  /// 进行中项左侧的品牌竖线，与会话选中线同语言。
  it("进行中的步骤左侧带品牌竖线", () => {
    const { container } = render(<TodoPanel todos={TODOS} />);
    const items = container.querySelectorAll("li");
    const inProgress = Array.from(items).find((li) => li.textContent?.includes("改接口"));
    expect(inProgress?.querySelector("span.bg-brand")).not.toBeNull();

    const done = Array.from(items).find((li) => li.textContent?.includes("读代码"));
    expect(done?.querySelector("span.bg-brand")).toBeNull();
  });
});
