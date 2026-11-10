import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => vi.resetModules());

async function mount(session: unknown) {
  vi.doMock("../store", () => ({
    useStore: () => ({ activeSession: session }),
  }));
  const { ContextWaterBar } = await import("./ContextWaterBar");
  return render(<ContextWaterBar contextLimit={10000} />);
}

describe("ContextWaterBar", () => {
  /// 没用量 / 没窗口上限时整块不渲染：宁可没有，也不画一个假进度
  it("没有真实用量时不渲染", async () => {
    const { container } = await mount({ id: "s1", lastUsage: undefined });
    expect(container).toBeEmptyDOMElement();
  });

  it("超出窗口上限时不渲染", async () => {
    vi.doMock("../store", () => ({
      useStore: () => ({ activeSession: { lastUsage: { input: 8000 } } }),
    }));
    const { ContextWaterBar } = await import("./ContextWaterBar");
    const { container } = render(<ContextWaterBar />);
    expect(container).toBeEmptyDOMElement();
  });

  it("七成时转警示色并给出归档建议", async () => {
    const { container } = await mount({
      lastUsage: { input: 8000, output: 100, total: 8100, llmMs: 0 },
    });
    const bar = screen.getByRole("progressbar", { name: "上下文水位" });
    expect(bar).toHaveAttribute("aria-valuenow", "80");
    // 填充色按档位切换；容器上带 title 说明
    expect(container.querySelector(".bg-warning")).not.toBeNull();
    expect(container.querySelector("[title]")?.getAttribute("title")).toContain(
      "/export",
    );
  });

  it("九成时转危险色", async () => {
    const { container } = await mount({
      lastUsage: { input: 9500, output: 100, total: 9600, llmMs: 0 },
    });
    expect(container.querySelector(".bg-danger")).not.toBeNull();
    expect(screen.getByText("95%")).toBeInTheDocument();
  });
});
