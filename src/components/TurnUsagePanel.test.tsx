import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
  vi.doUnmock("../store");
});

async function renderPanel(store: unknown) {
  vi.doMock("../store", () => ({ useStore: () => store }));
  const { TurnUsagePanel } = await import("./TurnUsagePanel");
  return render(<TurnUsagePanel />);
}

const WITH_USAGE = {
  activeSession: {
    lastUsage: { input: 120, output: 34, total: 154, llmMs: 1800 },
  },
};

describe("单轮 Token 用量", () => {
  it("显示后端上报的真实数值，不再按字符数估算", async () => {
    const { container } = await renderPanel(WITH_USAGE);
    expect(container.textContent).toContain("154");
    expect(container.textContent).not.toContain("约");

    fireEvent.click(screen.getByRole("button", { name: /本轮/ }));
    const dialog = screen.getByRole("dialog", { name: "本轮 Token 用量" });
    expect(dialog.textContent).toContain("120");
    expect(dialog.textContent).toContain("34");
    expect(dialog.textContent).toContain("1.8s");
  });

  it("上游没给用量时如实说明，不编造数字", async () => {
    const { container } = await renderPanel({ activeSession: {} });
    expect(container.textContent).toContain("本轮用量 —");
    fireEvent.click(screen.getByRole("button", { name: /本轮/ }));
    expect(screen.getByRole("dialog").textContent).toContain("尚未返回本轮用量");
    expect(container.textContent).not.toMatch(/约 \d/);
  });

  /// dsh 的 stat dialog 是锚定触发按钮上方的 portal 浮层，不是屏幕居中的
  /// 模态框。居中 + translate(-50%,-50%) 会把详情卡从输入框旁边拽走。
  it("详情浮层走 portal 的 fixed 定位，挂在触发按钮一侧", async () => {
    await renderPanel(WITH_USAGE);
    fireEvent.click(screen.getByRole("button", { name: /本轮/ }));
    const dialog = screen.getByRole("dialog");
    expect(dialog.parentElement).toBe(document.body);
    expect(dialog.style.position).toBe("fixed");
    expect(dialog.style.transform).toBe("");
  });

  it("详情是两列键值的成对明细，不是上下竖排", async () => {
    await renderPanel(WITH_USAGE);
    fireEvent.click(screen.getByRole("button", { name: /本轮/ }));
    const dialog = screen.getByRole("dialog");
    const terms = Array.from(dialog.querySelectorAll("dt"));
    const values = Array.from(dialog.querySelectorAll("dd"));
    expect(terms.length).toBe(4);
    expect(values.length).toBe(terms.length);
    expect(terms.map((el) => el.textContent)).toEqual([
      "输入",
      "输出",
      "合计",
      "模型耗时",
    ]);
  });

  it("触发按钮是无边框信息 pill", async () => {
    const { container } = await renderPanel(WITH_USAGE);
    const trigger = screen.getByRole("button", { name: /本轮/ });
    expect(trigger.className).not.toContain("border");
    expect(container.querySelector("[aria-haspopup='dialog']")).toBe(trigger);
  });

  it("Escape 与点击外部都能关闭详情", async () => {
    await renderPanel(WITH_USAGE);
    const trigger = screen.getByRole("button", { name: /本轮/ });
    fireEvent.click(trigger);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(trigger);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
