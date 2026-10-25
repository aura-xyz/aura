import { describe, expect, it } from "vitest";
import type { Block, ChatMessage } from "../store";
import {
  archiveCurrent,
  removedAssistant,
  switchVersion,
  versionCount,
  viewingHistory,
  viewingVersion,
} from "./versions";

function text(t: string): Block {
  return { kind: "text", text: t };
}

/** 取 assistant 消息的历史版本（类型收窄） */
function versionsOf(m: ChatMessage) {
  return m.role === "assistant" ? (m.versions ?? []) : [];
}

/** 取 assistant 消息的 blocks（类型收窄） */
function blocksOf(m: ChatMessage): Block[] {
  return m.role === "assistant" ? m.blocks : [];
}

function assistant(
  blocks: Block[],
  versions?: { id: string; blocks: Block[]; createdAt: number }[],
): ChatMessage {
  return {
    id: "m1",
    role: "assistant",
    blocks,
    ...(versions ? { versions } : {}),
  };
}

describe("versionCount", () => {
  it("无历史版本时算 1 个", () => {
    expect(versionCount(assistant([text("a")]))).toBe(1);
  });

  it("历史版本计入总数", () => {
    const m = assistant([text("a")], [
      { id: "v1", blocks: [text("b")], createdAt: 1 },
      { id: "v2", blocks: [text("c")], createdAt: 2 },
    ]);
    expect(versionCount(m)).toBe(3);
  });

  it("user 消息没有版本", () => {
    expect(versionCount({ id: "u", role: "user", content: "x" })).toBe(0);
  });
});

describe("viewingVersion", () => {
  it("默认显示最新", () => {
    const m = assistant([text("a")], [
      { id: "v1", blocks: [text("b")], createdAt: 1 },
    ]);
    expect(viewingVersion(m)).toBe(2);
    expect(viewingHistory(m)).toBe(false);
  });

  it("切到历史版本后 viewingVersion 变小", () => {
    const m = assistant([text("a")], [
      { id: "v1", blocks: [text("b")], createdAt: 1 },
    ]);
    const s = switchVersion(m, 1);
    expect(viewingVersion(s)).toBe(1);
    expect(viewingHistory(s)).toBe(true);
  });
});

describe("switchVersion", () => {
  const m = assistant([text("最新")], [
    { id: "v1", blocks: [text("最早")], createdAt: 1 },
    { id: "v2", blocks: [text("中间")], createdAt: 2 },
  ]);

  it("切到第 1 个版本显示最早的内容", () => {
    const s = switchVersion(m, 1);
    expect(blocksOf(s)[0]).toEqual(text("最早"));
    expect(viewingVersion(s)).toBe(1);
  });

  it("切到第 2 个版本显示中间的内容", () => {
    const s = switchVersion(m, 2);
    expect(blocksOf(s)[0]).toEqual(text("中间"));
    expect(viewingVersion(s)).toBe(2);
  });

  it("切回最新恢复原内容", () => {
    const s = switchVersion(switchVersion(m, 1), 3);
    expect(blocksOf(s)[0]).toEqual(text("最新"));
    expect(viewingVersion(s)).toBe(3);
  });

  it("切走再切回，最新版本不会丢", () => {
    // 这条是「切回最新」能工作的前提：切走时最新那份要被挪走保存
    const away = switchVersion(m, 1);
    expect(blocksOf(away)[0]).toEqual(text("最早"));
    const back = switchVersion(away, 3);
    expect(blocksOf(back)[0]).toEqual(text("最新"));
  });

  it("序号越界原样返回", () => {
    expect(switchVersion(m, 0)).toBe(m);
    expect(switchVersion(m, 4)).toBe(m);
  });

  it("只有一个版本时切不动", () => {
    const one = assistant([text("a")]);
    expect(switchVersion(one, 1)).toBe(one);
  });

  it("user 消息不参与", () => {
    const u: ChatMessage = { id: "u", role: "user", content: "x" };
    expect(switchVersion(u, 1)).toBe(u);
  });
});

describe("archiveCurrent", () => {
  it("把当前 blocks 存进历史版本", () => {
    const m = assistant([text("旧回答")]);
    const a = archiveCurrent(m);
    const vs = versionsOf(a);
    expect(vs).toHaveLength(1);
    expect(vs[0].blocks[0]).toEqual(text("旧回答"));
    // 当前内容不变
    expect(blocksOf(a)[0]).toEqual(text("旧回答"));
  });

  it("已有历史版本时追加", () => {
    const m = assistant([text("v2")], [
      { id: "v1", blocks: [text("v1")], createdAt: 1 },
    ]);
    const a = archiveCurrent(m);
    expect(versionsOf(a)).toHaveLength(2);
  });

  it("空回答不归档", () => {
    const m = assistant([]);
    expect(archiveCurrent(m)).toBe(m);
  });
});

describe("removedAssistant", () => {
  it("找出被删掉的那条 assistant 消息", () => {
    const before: ChatMessage[] = [
      { id: "u1", role: "user", content: "q1" },
      { id: "a1", role: "assistant", blocks: [text("r1")] },
      { id: "u2", role: "user", content: "q2" },
      { id: "a2", role: "assistant", blocks: [text("r2")] },
    ];
    const kept = before.slice(0, 2);
    const removed = removedAssistant(before, kept);
    expect(removed?.id).toBe("a2");
  });

  it("没有删掉 assistant 时返回 undefined", () => {
    const before: ChatMessage[] = [
      { id: "u1", role: "user", content: "q1" },
      { id: "a1", role: "assistant", blocks: [text("r1")] },
    ];
    expect(removedAssistant(before, before)).toBeUndefined();
  });

  it("只删了 user 消息时返回被删的 assistant（真实流程里 user 与其后的 assistant 一起被删）", () => {
    const before: ChatMessage[] = [
      { id: "u1", role: "user", content: "q1" },
      { id: "a1", role: "assistant", blocks: [text("r1")] },
    ];
    const kept = before.slice(0, 1);
    // a1 确实被删了，归档的就是它
    expect(removedAssistant(before, kept)?.id).toBe("a1");
  });
});
