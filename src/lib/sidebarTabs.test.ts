import { describe, expect, it } from "vitest";
import {
  activateTab,
  canCloseTab,
  closeTab,
  emptyTabsState,
  findByContent,
  openTab,
  sanitizeTabsState,
  terminalContentId,
  type SidebarTabsState,
} from "./sidebarTabs";

function stateWith(...kinds: [string, string][]): SidebarTabsState {
  let s = emptyTabsState();
  for (const [kind, contentId] of kinds) {
    s = openTab(s, kind as never, contentId, kind);
  }
  return s;
}

describe("右栏标签页模型", () => {
  it("打开标签后它成为当前标签", () => {
    const s = openTab(emptyTabsState(), "start", "sidebar://start", "开始页");
    expect(s.tabs).toHaveLength(1);
    expect(s.activeId).toBe(s.tabs[0].id);
  });

  it("同种类同内容不重复开，只激活已有的", () => {
    let s = openTab(emptyTabsState(), "files", "ws", "文件");
    s = openTab(s, "terminal", terminalContentId("t1"), "终端");
    const before = s.tabs.length;
    s = openTab(s, "terminal", terminalContentId("t1"), "终端");
    expect(s.tabs).toHaveLength(before);
    expect(s.activeId).toBe(s.tabs[1].id);
  });

  it("不同内容的同种类可以并存", () => {
    let s = openTab(emptyTabsState(), "terminal", terminalContentId("t1"), "终端");
    s = openTab(s, "terminal", terminalContentId("t2"), "终端");
    expect(s.tabs).toHaveLength(2);
  });

  it("至少保留一个标签", () => {
    const s = openTab(emptyTabsState(), "start", "sidebar://start", "开始页");
    expect(canCloseTab(s, s.tabs[0].id)).toBe(false);
    expect(closeTab(s, s.tabs[0].id)).toBe(s);
  });

  it("关掉当前标签后激活右边那个", () => {
    let s = stateWith(["files", "ws"], ["web", "u"], ["terminal", "t"]);
    const middle = s.tabs[1].id;
    s = activateTab(s, middle);
    s = closeTab(s, middle);
    expect(s.tabs.map((t) => t.id)).toEqual([s.tabs[0].id, s.tabs[1].id]);
    expect(s.activeId).toBe(s.tabs[1].id);
  });

  it("关掉最后一个标签时激活左边的", () => {
    let s = stateWith(["files", "ws"], ["web", "u"]);
    const last = s.tabs[1].id;
    s = activateTab(s, last);
    s = closeTab(s, last);
    expect(s.tabs).toHaveLength(1);
    expect(s.activeId).toBe(s.tabs[0].id);
  });

  it("关掉非当前标签不动当前标签", () => {
    let s = stateWith(["files", "ws"], ["web", "u"], ["terminal", "t"]);
    s = activateTab(s, s.tabs[2].id);
    const activeBefore = s.activeId;
    s = closeTab(s, s.tabs[0].id);
    expect(s.activeId).toBe(activeBefore);
  });

  it("激活不存在的标签原样返回", () => {
    const s = stateWith(["files", "ws"]);
    expect(activateTab(s, "tab999")).toBe(s);
  });

  it("按内容身份查找标签", () => {
    const s = stateWith(["terminal", terminalContentId("abc")]);
    expect(findByContent(s, "terminal", terminalContentId("abc"))).toBeDefined();
    expect(findByContent(s, "terminal", terminalContentId("xyz"))).toBeUndefined();
  });

  it("存档里不认识的种类与终端标签一律丢弃", () => {
    const raw = {
      tabs: [
        { id: "tab1", kind: "files", contentId: "ws", title: "文件" },
        { id: "tab2", kind: "wat", contentId: "x", title: "?" },
        { id: "tab3", kind: "terminal", contentId: "terminal:t1", title: "终端" },
      ],
      activeId: "tab2",
      seq: 9,
    };
    const s = sanitizeTabsState(raw);
    expect(s).not.toBeNull();
    expect(s!.tabs).toHaveLength(1);
    expect(s!.tabs[0].kind).toBe("files");
    // activeId 指向已丢弃的标签时回落到第一个
    expect(s!.activeId).toBe("tab1");
  });

  it("存档里 id 重复时只留一个", () => {
    const raw = {
      tabs: [
        { id: "tab1", kind: "files", contentId: "a", title: "A" },
        { id: "tab1", kind: "web", contentId: "b", title: "B" },
      ],
      activeId: "tab1",
    };
    const s = sanitizeTabsState(raw);
    expect(s!.tabs).toHaveLength(1);
    expect(s!.tabs[0].contentId).toBe("a");
  });

  it("存档结构不对时返回 null，不抛错", () => {
    expect(sanitizeTabsState(null)).toBeNull();
    expect(sanitizeTabsState("nope")).toBeNull();
    expect(sanitizeTabsState({})).toBeNull();
    expect(sanitizeTabsState({ tabs: "x" })).toBeNull();
  });

  it("存档里的 seq 不会小于已有标签的序号", () => {
    const raw = {
      tabs: [{ id: "tab7", kind: "files", contentId: "a", title: "A" }],
      activeId: "tab7",
      seq: 1,
    };
    const s = sanitizeTabsState(raw);
    expect(s!.seq).toBeGreaterThan(7);
  });
});
