import { render, screen } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAnchoredPanel } from "./useAnchoredPanel";

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    left,
    top,
    right: left + width,
    bottom: top + height,
    width,
    height,
    x: left,
    y: top,
    toJSON: () => ({}),
  } as DOMRect;
}

/** 触发元素与浮层的尺寸由测试注入，jsdom 没有排版测量。 */
function mockLayout(anchorTop: number, panelHeight: number) {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      if (this.getAttribute("data-testid") === "anchor") {
        return rect(950, anchorTop, 50, 28);
      }
      if (this.getAttribute("data-testid") === "panel") {
        return rect(0, 0, 224, panelHeight);
      }
      return rect(0, 0, 0, 0);
    },
  );
}

function Harness({ open, side }: { open: boolean; side: "top" | "bottom" }) {
  const anchorRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const pos = useAnchoredPanel(anchorRef, panelRef, open, side);
  return (
    <>
      <div ref={anchorRef} data-testid="anchor" />
      <div ref={panelRef} data-testid="panel" style={pos} />
    </>
  );
}

afterEach(() => vi.restoreAllMocks());

describe("浮层视口钳制", () => {
  it("未打开时保持隐藏但仍可测量", () => {
    mockLayout(20, 400);
    render(<Harness open={false} side="bottom" />);
    const panel = screen.getByTestId("panel");
    expect(panel.style.visibility).toBe("hidden");
    expect(panel.style.position).toBe("fixed");
  });

  it("右上角触发时右边缘对齐且不横向溢出窗口", () => {
    mockLayout(20, 400);
    render(<Harness open side="bottom" />);
    const panel = screen.getByTestId("panel");
    const left = Number.parseFloat(panel.style.left);
    const rightEdge = left + 224;
    expect(rightEdge).toBeLessThanOrEqual(window.innerWidth - 12);
    expect(left).toBeGreaterThanOrEqual(12);
    expect(panel.style.visibility).toBe("visible");
  });

  it("下方空间不够时翻到触发元素上方", () => {
    // 触发元素贴近窗口底部，400px 的面板放不下
    mockLayout(700, 400);
    render(<Harness open side="bottom" />);
    const panel = screen.getByTestId("panel");
    const top = Number.parseFloat(panel.style.top);
    expect(top).toBeLessThan(700);
    expect(top + 400).toBeLessThanOrEqual(window.innerHeight - 12);
  });

  it("side=top 优先放在上方", () => {
    mockLayout(500, 200);
    render(<Harness open side="top" />);
    const top = Number.parseFloat(screen.getByTestId("panel").style.top);
    expect(top).toBeLessThan(500);
  });
});
