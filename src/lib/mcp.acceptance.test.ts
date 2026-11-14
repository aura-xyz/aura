/**
 * MCP 二期前端契约回归（M2-12）。
 *
 * 组件测试覆盖的是「点下去会怎样」，这里覆盖命令封装与跨服务器聚合：
 * 参数名、camelCase 转换、单台服务器失败时的降级，都是容易被改动悄悄
 * 破坏、又不会被组件测试发现的边界。
 */
import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  defaultPolicy,
  loadAllPrompts,
  readResource,
  setServerPolicy,
} from "./mcp";

const invokeMock = vi.mocked(invoke);

beforeEach(() => {
  invokeMock.mockReset().mockResolvedValue(null as never);
});

describe("loadAllPrompts 跨服务器聚合", () => {
  it("只查已启用服务器，单台失败不影响其余", async () => {
    const servers = [
      { id: 1, name: "alpha", enabled: true },
      { id: 2, name: "beta", enabled: true },
      { id: 3, name: "off", enabled: false },
    ];
    invokeMock.mockImplementation(async (cmd: string, args?: Record<string, unknown>) => {
      if (cmd === "mcp_list_servers") return servers as never;
      if (cmd === "mcp_list_prompts") {
        if (args?.id === 1) throw new Error("服务器未连接");
        return [
          { name: "zeta", description: "", arguments: [] },
          { name: "alpha-prompt", description: "", arguments: [] },
        ] as never;
      }
      return null as never;
    });

    const out = await loadAllPrompts();
    expect(out).toHaveLength(2);
    expect(out.every((p) => p.server_id === 2 && p.server_name === "beta")).toBe(true);
    // 按 server/name 排序
    expect(out.map((p) => p.name)).toEqual(["alpha-prompt", "zeta"]);
    expect(invokeMock).not.toHaveBeenCalledWith("mcp_list_prompts", { id: 3 });
  });

  it("服务器列表接口异常或返回非数组时降级为空", async () => {
    invokeMock.mockRejectedValueOnce(new Error("offline"));
    expect(await loadAllPrompts()).toEqual([]);
    invokeMock.mockResolvedValueOnce(null as never);
    expect(await loadAllPrompts()).toEqual([]);
  });
});

describe("命令封装的参数契约", () => {
  it("setServerPolicy 原样传 policy 对象", async () => {
    await setServerPolicy(7, defaultPolicy());
    expect(invokeMock).toHaveBeenCalledWith("mcp_set_server_policy", {
      id: 7,
      policy: defaultPolicy(),
    });
  });

  it("readResource 带 sessionId 供后端写时间线", async () => {
    await readResource(7, "file:///a.txt", "s1");
    expect(invokeMock).toHaveBeenCalledWith("mcp_read_resource", {
      id: 7,
      uri: "file:///a.txt",
      sessionId: "s1",
    });
  });
});
