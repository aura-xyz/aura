import { beforeEach, describe, expect, it } from "vitest";
import {
  allInputDrafts,
  clearInputDraft,
  loadInputDraft,
  saveInputDraft,
} from "./draft";

beforeEach(() => {
  localStorage.clear();
});

describe("输入草稿", () => {
  it("存取往返", () => {
    saveInputDraft("s1", "hello");
    expect(loadInputDraft("s1")).toBe("hello");
  });

  it("没有草稿返回空串，不抛错", () => {
    expect(loadInputDraft("nope")).toBe("");
  });

  it("空串会话 id 读写都安全（新对话还没有 id）", () => {
    saveInputDraft("", "x");
    expect(loadInputDraft("")).toBe("");
  });

  it("空白内容等同于删除，不占配额", () => {
    saveInputDraft("s1", "有内容");
    saveInputDraft("s1", "   ");
    expect(loadInputDraft("s1")).toBe("");
    expect(allInputDrafts()).toEqual({});
  });

  it("各会话互不污染", () => {
    saveInputDraft("s1", "A");
    saveInputDraft("s2", "B");
    expect(loadInputDraft("s1")).toBe("A");
    expect(loadInputDraft("s2")).toBe("B");
  });

  it("clearInputDraft 只清指定会话", () => {
    saveInputDraft("s1", "A");
    saveInputDraft("s2", "B");
    clearInputDraft("s1");
    expect(loadInputDraft("s1")).toBe("");
    expect(loadInputDraft("s2")).toBe("B");
  });

  it("localStorage 内容损坏时当空处理，不抛错", () => {
    localStorage.setItem("aura:input-drafts", "{ 这不是 json");
    expect(loadInputDraft("s1")).toBe("");
    // 且仍可继续写入
    saveInputDraft("s1", "x");
    expect(loadInputDraft("s1")).toBe("x");
  });

  it("存的是数组而非对象时当空处理", () => {
    localStorage.setItem("aura:input-drafts", '["a","b"]');
    expect(loadInputDraft("s1")).toBe("");
  });

  it("超长内容被截断，防止撑爆 localStorage", () => {
    const huge = "x".repeat(50000);
    saveInputDraft("s1", huge);
    expect(loadInputDraft("s1").length).toBeLessThan(huge.length);
  });
});
