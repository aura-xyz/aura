import { describe, expect, it, vi } from "vitest";
import {
  codeBlockMenuItems,
  findCodeBlockTarget,
  findMessageTarget,
  messageMenuItems,
  textMenuItems,
} from "./contextMenuItems";

describe("右键菜单条目", () => {
  it("消息气泡固定给复制全文，可选引用", () => {
    const onCopy = vi.fn();
    expect(messageMenuItems({ onCopy }).map((i) => i.label)).toEqual(["复制全文"]);
  });

  it("传了引用回调就多一项，且顺序在复制之后", () => {
    const items = messageMenuItems({ onCopy: vi.fn(), onQuote: vi.fn() });
    expect(items.map((i) => i.label)).toEqual(["复制全文", "引用"]);
  });

  it("代码块只给复制代码，不多给", () => {
    const items = codeBlockMenuItems({ onCopy: vi.fn() });
    expect(items).toHaveLength(1);
    expect(items[0].label).toBe("复制代码");
  });

  it("正文只给复制", () => {
    expect(textMenuItems({ onCopy: vi.fn() })[0].label).toBe("复制");
  });

  it("条目点击走对应回调", () => {
    const onCopy = vi.fn();
    messageMenuItems({ onCopy })[0].onClick();
    expect(onCopy).toHaveBeenCalledTimes(1);
  });

  it("条目都不是危险样式（删除才该是红的）", () => {
    for (const item of [
      ...messageMenuItems({ onCopy: vi.fn() }),
      ...codeBlockMenuItems({ onCopy: vi.fn() }),
      ...textMenuItems({ onCopy: vi.fn() }),
    ]) {
      expect(item.danger).toBeFalsy();
    }
  });
});

describe("目标定位", () => {
  it("命中消息气泡时返回该元素", () => {
    const el = document.createElement("div");
    el.setAttribute("data-ctx-message", "some text");
    expect(findMessageTarget(el)).toBe(el);
  });

  it("气泡内的深层子节点也能找到祖先", () => {
    const wrap = document.createElement("div");
    wrap.setAttribute("data-ctx-message", "x");
    const inner = document.createElement("span");
    wrap.appendChild(inner);
    expect(findMessageTarget(inner)).toBe(wrap);
  });

  it("消息区之外返回 null（不会误弹消息菜单）", () => {
    const el = document.createElement("div");
    expect(findMessageTarget(el)).toBeNull();
  });

  it("代码块定位同理", () => {
    const el = document.createElement("div");
    el.setAttribute("data-ctx-codeblock", "code");
    expect(findCodeBlockTarget(el)).toBe(el);
    expect(findCodeBlockTarget(document.createElement("div"))).toBeNull();
  });

  it("消息与代码块互不误判", () => {
    const code = document.createElement("div");
    code.setAttribute("data-ctx-codeblock", "code");
    expect(findMessageTarget(code)).toBeNull();

    const msg = document.createElement("div");
    msg.setAttribute("data-ctx-message", "text");
    expect(findCodeBlockTarget(msg)).toBeNull();
  });

  it("null 目标安全返回 null", () => {
    expect(findMessageTarget(null)).toBeNull();
    expect(findCodeBlockTarget(null)).toBeNull();
  });
});
