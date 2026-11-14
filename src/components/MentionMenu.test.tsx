import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { MentionItem } from "../lib/mentions";
import { MENTION_LISTBOX_ID, listboxOptionId } from "./MenuPopup";
import MentionMenu from "./MentionMenu";

const ITEMS: MentionItem[] = [
  { kind: "file", label: "a.ts", detail: "src", insert: "<src/a.ts> " },
  { kind: "file", label: "b.ts", detail: "src", insert: "<src/b.ts> " },
  { kind: "file", label: "c.ts", detail: "src", insert: "<src/c.ts> " },
];

describe("MentionMenu 无障碍与鼠标交互", () => {
  it("listbox 的 activedescendant 指向当前高亮项", () => {
    render(
      <MentionMenu
        kind="file"
        items={ITEMS}
        activeIndex={1}
        onPick={vi.fn()}
        onHover={vi.fn()}
      />,
    );
    const list = screen.getByRole("listbox", { name: "文件引用" });
    expect(list).toHaveAttribute("id", MENTION_LISTBOX_ID);
    expect(list).toHaveAttribute(
      "aria-activedescendant",
      listboxOptionId(MENTION_LISTBOX_ID, 1),
    );

    const options = screen.getAllByRole("option");
    expect(options[1]).toHaveAttribute("aria-selected", "true");
    expect(options[0]).toHaveAttribute("aria-selected", "false");
    expect(options[1].id).toBe(list.getAttribute("aria-activedescendant"));
  });

  it("每个候选项都有稳定 id，鼠标划过回传下标", async () => {
    const onHover = vi.fn();
    render(
      <MentionMenu
        kind="file"
        items={ITEMS}
        activeIndex={0}
        onPick={vi.fn()}
        onHover={onHover}
      />,
    );
    const options = screen.getAllByRole("option");
    expect(options.map((o) => o.id)).toEqual(
      [0, 1, 2].map((i) => listboxOptionId(MENTION_LISTBOX_ID, i)),
    );
    await userEvent.hover(options[2]);
    expect(onHover).toHaveBeenCalledWith(2);
  });

  it("没有候选时整个浮层不渲染", () => {
    const { container } = render(
      <MentionMenu
        kind="skill"
        items={[]}
        activeIndex={0}
        onPick={vi.fn()}
        onHover={vi.fn()}
      />,
    );
    expect(container.firstChild).toBeNull();
  });
});
