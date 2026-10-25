import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import ScrollToBottom, { NEAR_BOTTOM_PX } from "./ScrollToBottom";

/**
 * 造一个可编程高度的假滚动容器。
 *
 * scrollTop / scrollHeight / clientHeight 都是只读 getter（jsdom 与真 DOM
 * 一致），必须 defineProperty 覆写。scrollTo 用调用捕获而非 vi.fn——
 * Element.scrollTo 是重载签名，vi.fn 直接赋值过不了类型检查。
 */
function makeEl() {
  const el = document.createElement("div");
  Object.defineProperty(el, "scrollHeight", { value: 5000, writable: true });
  Object.defineProperty(el, "clientHeight", { value: 800, writable: true });
  Object.defineProperty(el, "scrollTop", { value: 0, writable: true });

  const calls: Array<ScrollToOptions | number> = [];
  el.scrollTo = ((opts: ScrollToOptions | number) => {
    calls.push(opts);
    el.scrollTop = typeof opts === "number" ? opts : (opts.top ?? 0);
    el.dispatchEvent(new Event("scroll"));
  }) as typeof el.scrollTo;

  document.body.appendChild(el);
  return { el, calls };
}

function mountAt(el: HTMLDivElement) {
  const ref = { current: el } as React.RefObject<HTMLDivElement | null>;
  return render(<ScrollToBottom scrollRef={ref} messagesLength={3} />);
}

describe("ScrollToBottom", () => {
  it("在底部时不显示按钮", () => {
    const { el } = makeEl();
    el.scrollTop = 5000; // 距底 = 5000 - 5000 - 800 = -800 < 阈值
    mountAt(el);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("偏离底部时显示按钮", () => {
    const { el } = makeEl();
    el.scrollTop = 0; // 距底 4200
    mountAt(el);
    expect(
      screen.getByRole("button", { name: "回到底部" }),
    ).toBeInTheDocument();
  });

  it("阈值边界：距底小于阈值才隐藏，等于阈值即显示", async () => {
    const { el } = makeEl();
    // 距底 = scrollHeight - scrollTop - clientHeight。
    // 组件的口径是「严格小于 140 才算在底部」，与 App.tsx 的自动跟随同源。
    el.scrollTop = 5000 - 800 - NEAR_BOTTOM_PX; // 距底 = 140 → 偏离
    mountAt(el);
    expect(
      screen.getByRole("button", { name: "回到底部" }),
    ).toBeInTheDocument();

    el.scrollTop += 1; // 距底 = 139 → 算在底部
    el.dispatchEvent(new Event("scroll"));
    await waitFor(() => expect(screen.queryByRole("button")).toBeNull());
  });

  it("点击滚到底部并随即隐藏", async () => {
    const { el, calls } = makeEl();
    el.scrollTop = 0;
    mountAt(el);
    screen.getByRole("button", { name: "回到底部" }).click();

    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({ top: 5000 });
    await waitFor(() => expect(screen.queryByRole("button")).toBeNull());
  });

  it("新消息到达时重算可见性（容器被推长）", () => {
    const { el } = makeEl();
    el.scrollTop = 4200; // 距底 0 → 隐藏
    const ref = { current: el } as React.RefObject<HTMLDivElement | null>;
    const { rerender } = render(
      <ScrollToBottom scrollRef={ref} messagesLength={3} />,
    );
    expect(screen.queryByRole("button")).toBeNull();

    // 新消息把 scrollHeight 推长，用户停在旧位置 → 现在偏离底部了
    (el as HTMLDivElement & { scrollHeight: number }).scrollHeight = 9000;
    rerender(<ScrollToBottom scrollRef={ref} messagesLength={4} />);
    expect(
      screen.getByRole("button", { name: "回到底部" }),
    ).toBeInTheDocument();
  });
});
