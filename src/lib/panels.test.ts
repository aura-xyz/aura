import { beforeEach, describe, expect, it } from "vitest";
import { PanelRegistry } from "./panels";

let registry: PanelRegistry;
beforeEach(() => {
  registry = new PanelRegistry();
});

describe("右栏面板注册表", () => {
  it("按 order 派生列表，而不是按注册顺序", () => {
    registry.register({ id: "todo", label: "任务", order: 30 });
    registry.register({ id: "files", label: "文件", order: 10 });
    registry.register({ id: "web", label: "网页", order: 20 });
    expect(registry.list().map((p) => p.id)).toEqual(["files", "web", "todo"]);
  });

  it("同 id 重复注册直接报错，避免两个面板抢一个 tab", () => {
    registry.register({ id: "files", label: "文件", order: 10 });
    expect(() => registry.register({ id: "files", label: "文件2", order: 11 })).toThrow(
      /已注册/,
    );
  });

  it("卸载器移除面板后列表随之变化", () => {
    const dispose = registry.register({ id: "files", label: "文件", order: 10 });
    expect(registry.has("files")).toBe(true);
    dispose();
    expect(registry.has("files")).toBe(false);
    expect(registry.list()).toEqual([]);
  });
});
