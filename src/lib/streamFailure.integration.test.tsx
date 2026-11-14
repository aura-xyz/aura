import { act, render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 流式失败的集成契约（v0.8.1 P12）。
 *
 * 纯函数测不出「失败那一刻 buffer 里还压着半句正文」：只验 store 的 state
 * 会漏掉最要命的用户可见 bug。这里把事件流真的驱动起来，从渲染结果上
 * 确认「已生成内容保留 + 失败状态可重试 + 能忽略」。
 */
type Handler = (e: { payload: unknown }) => void;
const handlers = new Map<string, Handler>();

beforeEach(() => {
  handlers.clear();
  vi.resetModules();
  vi.doMock("@tauri-apps/api/core", () => ({
    invoke: vi.fn(async (cmd: string, args?: Record<string, unknown>) => {
      switch (cmd) {
        case "get_workspace":
          return "E:/ws";
        case "set_workspace":
          return args?.path;
        case "load_sessions":
          return [];
        case "get_models":
          return [];
        case "get_selected_model":
          return "";
        // 挂住这一轮，才能在流进行中注入 error 事件
        case "send_message":
          return new Promise(() => {});
        default:
          return null;
      }
    }),
  }));
  vi.doMock("@tauri-apps/api/event", () => ({
    listen: vi.fn(async (name: string, cb: Handler) => {
      handlers.set(name, cb);
      return () => handlers.delete(name);
    }),
  }));
});

function fire(name: string, payload: unknown) {
  const h = handlers.get(name);
  if (!h) throw new Error(`事件 ${name} 没有监听者`);
  act(() => h({ payload }));
}

async function mountAndSend(text: string) {
  const store = await import("../store");
  let api: ReturnType<typeof store.useStore> | null = null;

  function Probe() {
    api = store.useStore();
    const msgs = api.activeSession?.messages ?? [];
    return (
      <div>
        {msgs.map((m, i) =>
          m.role === "user" ? (
            <div key={i} data-kind="user" data-text={m.content} />
          ) : (
            <div key={i}>
              {m.blocks.map((b, j) => (
                <div key={j} data-kind={b.kind} data-text={b.text} />
              ))}
            </div>
          ),
        )}
      </div>
    );
  }

  render(
    <store.StoreProvider>
      <Probe />
    </store.StoreProvider>,
  );
  await waitFor(() => expect(api?.activeId).toBeTruthy());
  await act(async () => {
    await api!.setSessionWorkspace("E:/ws");
  });
  const sessionId = api!.activeId;
  act(() => {
    void api!.sendMessage(text);
  });
  return { sessionId, read: () => api! };
}

function kinds(): string[] {
  return [...document.querySelectorAll("[data-kind]")].map(
    (e) => `${e.getAttribute("data-kind")}:${e.getAttribute("data-text")}`,
  );
}

describe("流式失败状态机", () => {
  it("agent:error 时排空缓冲，正文与错误块都在且记录可重试失败", async () => {
    const { sessionId, read } = await mountAndSend("帮我看看");

    fire("agent:chunk", { session_id: sessionId, text: "先说一句" });
    fire("agent:error", {
      session_id: sessionId,
      text: "连接中断：stream closed",
    });

    expect(kinds()).toEqual([
      "user:帮我看看",
      "text:先说一句",
      "error:网络连接中断或超时，已保留已生成的内容。",
    ]);
    expect(read().failure).toMatchObject({
      sessionId,
      kind: "interrupted",
      code: "net_timeout",
      retryable: true,
      userIndex: 1,
      text: "帮我看看",
    });
  });

  it("忽略失败提示只清状态，不删已生成的回答", async () => {
    const { sessionId, read } = await mountAndSend("干活");
    fire("agent:chunk", { session_id: sessionId, text: "已经写了一部分" });
    fire("agent:error", { session_id: sessionId, text: "401 Unauthorized" });

    expect(read().failure).toMatchObject({ kind: "failed", retryable: false });
    act(() => read().dismissFailure());
    expect(read().failure).toBeNull();
    expect(kinds()).toContain("text:已经写了一部分");
  });
});
