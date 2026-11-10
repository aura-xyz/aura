import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import AlertBar from "./AlertBar";

describe("AlertBar", () => {
  /// 横幅语言统一的核心是左侧 2px 状态色竖线：四档各自带自己的颜色。
  it("四档变体各自带状态色竖线", () => {
    const map = {
      info: "border-l-brand",
      edit: "border-l-brand",
      success: "border-l-success",
      danger: "border-l-danger",
    } as const;
    for (const [variant, cls] of Object.entries(map)) {
      const { container, unmount } = render(
        <AlertBar variant={variant as keyof typeof map}>内容</AlertBar>,
      );
      const bar = container.firstElementChild as HTMLElement;
      expect(bar.className).toContain("border-l-2");
      expect(bar.className).toContain(cls);
      unmount();
    }
  });

  it("默认 info，并渲染正文与右侧动作", () => {
    const onClick = vi.fn();
    const { container } = render(
      <AlertBar action={<button type="button" onClick={onClick}>取消</button>}>
        正在编辑之前的消息
      </AlertBar>,
    );
    const bar = container.firstElementChild as HTMLElement;
    expect(bar.className).toContain("border-l-brand");
    expect(screen.getByText("正在编辑之前的消息")).toBeInTheDocument();
    screen.getByRole("button", { name: "取消" }).click();
    expect(onClick).toHaveBeenCalled();
  });

  /// 图标是可选的：不传时不留空位，否则文案会平白右移 20px。
  it("不传 icon 时不占位", () => {
    const withIcon = render(<AlertBar icon={<span data-testid="ic" />}>a</AlertBar>);
    const iconSlots = withIcon.container.querySelectorAll('[aria-hidden="true"]');
    expect(iconSlots.length).toBe(1);
    withIcon.unmount();

    const plain = render(<AlertBar>b</AlertBar>);
    expect(plain.container.querySelectorAll('[aria-hidden="true"]').length).toBe(0);
  });
});
