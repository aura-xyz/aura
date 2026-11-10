import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
  vi.doUnmock("../store");
  vi.doUnmock("./Markdown");
});

function msg(id: string, text: string) {
  return { id, role: "assistant" as const, blocks: [{ kind: "text" as const, text }] };
}

describe("MessageList 渲染开销", () => {
  /**
   * 打字机每 30ms 触发一次 setState，若历史消息跟着重渲染，
   * 就会连带把其中每个 Markdown 重新解析一遍（remark + 高亮 + KaTeX）。
   * 长对话积累到几百个 block 后，这会让流式输出明显卡顿——
   * 且**不会报错**，只会越来越慢。
   *
   * memo 能拦住的前提是 store 侧对未参与更新的消息保持对象引用不变。
   * 一旦有人把 appendBlocks 改成深拷贝或全量重建，memo 会静默失效，
   * 所以在这里钉住。
   */
  it("打字机推进时只重新渲染正在接收流量的那一条消息", async () => {
    const renderCount: Record<string, number> = {};
    vi.doMock("./Markdown", () => ({
      default: ({ content }: { content: string }) => {
        renderCount[content] = (renderCount[content] ?? 0) + 1;
        return <div data-testid="md">{content}</div>;
      },
    }));

    const history = msg("m1", "已经写完的消息");
    let messages = [history, msg("m2", "正在生成")];

    const store = {
      get activeSession() {
        return { messages };
      },
      busy: true,
    };
    vi.doMock("../store", () => ({ useStore: () => store }));

    const { default: MessageList } = await import("./MessageList");
    const { rerender } = render(<MessageList />);

    expect(renderCount["已经写完的消息"]).toBe(1);
    expect(renderCount["正在生成"]).toBe(1);

    // 模拟打字机推进：只有活动消息拿到新的 blocks 数组，
    // 历史消息沿用原对象引用——这正是 store.appendBlocks 的实际行为
    messages = [history, msg("m2", "正在生成…")];
    rerender(<MessageList />);

    expect(
      renderCount["已经写完的消息"],
      "历史消息的 Markdown 不应被重新解析——memo 失效或 store 丢了引用稳定性",
    ).toBe(1);
    expect(renderCount["正在生成…"]).toBe(1);
  });

  /** 兜底：memo 不能把内容变化也拦掉，否则流式输出会停住。 */
  it("活动消息内容变化时仍会重渲染", async () => {
    const renderCount: Record<string, number> = {};
    vi.doMock("./Markdown", () => ({
      default: ({ content }: { content: string }) => {
        renderCount[content] = (renderCount[content] ?? 0) + 1;
        return <div data-testid="md">{content}</div>;
      },
    }));

    let messages = [msg("m1", "第一段")];
    const store = {
      get activeSession() {
        return { messages };
      },
      busy: true,
    };
    vi.doMock("../store", () => ({ useStore: () => store }));

    const { default: MessageList } = await import("./MessageList");
    const { rerender } = render(<MessageList />);
    messages = [msg("m1", "第一段第二句")];
    rerender(<MessageList />);

    expect(renderCount["第一段第二句"]).toBe(1);
  });
});

describe("思考折叠行的生成中状态", () => {
  /**
   * running 曾写死 false，于是「生成中…」、遮罩与 data-state 全是死代码。
   * 只有当前正在接收流量的最后一块才算生成中，历史思考行必须显示已就绪。
   */
  it("流式中的思考块显示生成中，流结束后显示已就绪", async () => {
    vi.doMock("./Markdown", () => ({
      default: ({ content }: { content: string }) => <div>{content}</div>,
    }));
    let busy = true;
    const messages = [
      { id: "u1", role: "user" as const, content: "看一下" },
      {
        id: "a1",
        role: "assistant" as const,
        blocks: [{ kind: "thinking" as const, text: "先看目录结构" }],
      },
    ];
    const store = {
      get activeSession() {
        return { messages };
      },
      get busy() {
        return busy;
      },
      resendFrom: vi.fn(),
      switchMessageVersion: vi.fn(),
      beginEdit: vi.fn(),
    };
    vi.doMock("../store", () => ({ useStore: () => store }));

    const { default: MessageList } = await import("./MessageList");
    const { container, rerender } = render(<MessageList />);
    expect(container.querySelector("[data-state]")?.getAttribute("data-state")).toBe(
      "running",
    );
    expect(container.textContent).toContain("生成中");

    busy = false;
    rerender(<MessageList />);
    expect(container.querySelector("[data-state]")?.getAttribute("data-state")).toBe(
      "ok",
    );
    expect(container.textContent).toContain("已就绪");
  });
});

describe("右侧时间线的轮次锚点", () => {
  /// 时间线点击后靠 [data-turn] 定位消息。序号必须与 turnRail 的
  /// 1-based 轮次一致，且每条用户消息恰好一个锚点，否则会跳错一轮。
  it("每条用户消息带递增的 data-turn", async () => {
    vi.doMock("./Markdown", () => ({
      default: ({ content }: { content: string }) => <div>{content}</div>,
    }));
    const messages = [
      { id: "u1", role: "user" as const, content: "第一问" },
      { id: "a1", role: "assistant" as const, blocks: [{ kind: "text" as const, text: "答一" }] },
      { id: "u2", role: "user" as const, content: "第二问" },
      { id: "a2", role: "assistant" as const, blocks: [{ kind: "text" as const, text: "答二" }] },
    ];
    const store = {
      get activeSession() {
        return { messages };
      },
      get busy() {
        return false;
      },
      resendFrom: vi.fn(),
      switchMessageVersion: vi.fn(),
      beginEdit: vi.fn(),
    };
    vi.doMock("../store", () => ({ useStore: () => store }));

    const { default: MessageList } = await import("./MessageList");
    const { container } = render(<MessageList />);
    const anchors = Array.from(container.querySelectorAll("[data-turn]"));
    expect(anchors.map((a) => a.getAttribute("data-turn"))).toEqual(["1", "2"]);
  });

  /// C13：离屏消息加 content-visibility 省布局，但正在流式写入的最后一条
  /// 不能挂——每次追加都会触发重排，占位高度还会跳。
  it("历史消息标记为离屏渲染，最后一条流式消息不标记", async () => {
    vi.doMock("./Markdown", () => ({
      default: ({ content }: { content: string }) => <div>{content}</div>,
    }));
    const messages = [
      msg("m1", "第一条回答"),
      msg("m2", "第二条回答"),
      msg("m3", "正在生成"),
    ];
    const store = {
      get activeSession() {
        return { messages };
      },
      get busy() {
        return true;
      },
      resendFrom: vi.fn(),
      switchMessageVersion: vi.fn(),
      beginEdit: vi.fn(),
    };
    vi.doMock("../store", () => ({ useStore: () => store }));

    const { default: MessageList } = await import("./MessageList");
    const { container } = render(<MessageList />);

    expect(container.querySelectorAll(".aura-msg-virtual")).toHaveLength(2);
    const wrappers = Array.from(container.querySelectorAll(".group"));
    expect(wrappers[0].className).toContain("aura-msg-virtual");
    expect(wrappers[wrappers.length - 1].className).not.toContain("aura-msg-virtual");
  });
});
