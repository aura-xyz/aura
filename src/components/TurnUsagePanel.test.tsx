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

describe("单轮 Token 用量", () => {
  it("显示后端上报的真实数值，不再按字符数估算", async () => {
    const { container } = await renderPanel({
      activeSession: {
        lastUsage: { input: 120, output: 34, total: 154, llmMs: 1800 },
      },
    });
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
});
