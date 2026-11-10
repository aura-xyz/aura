import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import NoticeStack from "./NoticeStack";
import { notify, noticesSnapshot, resetNotices } from "../lib/notices";

beforeEach(() => resetNotices());

describe("NoticeStack", () => {
  it("队列为空时不占位", () => {
    const { container } = render(<NoticeStack />);
    expect(container).toBeEmptyDOMElement();
  });

  it("成功与失败各用语义色，失败用 alert 角色", () => {
    notify("ok", "已导出");
    notify("error", "导出失败：磁盘满");
    render(<NoticeStack />);

    expect(screen.getByRole("status")).toHaveTextContent("已导出");
    const failed = screen.getByRole("alert");
    expect(failed).toHaveTextContent("导出失败：磁盘满");
    // 红/绿由图标语义色承担，容器边框区分危险等级
    expect(failed.className).toContain("border-danger/40");
  });

  it("可堆叠，点关闭只移除自己那一条", async () => {
    notify("ok", "一");
    notify("ok", "二");
    render(<NoticeStack />);

    expect(screen.getAllByRole("status")).toHaveLength(2);
    await userEvent.click(screen.getAllByRole("button", { name: "关闭提示" })[0]);

    expect(noticesSnapshot().map((n) => n.text)).toEqual(["二"]);
    expect(screen.getAllByRole("status")).toHaveLength(1);
  });
});
