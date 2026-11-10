import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { useConfirm } from "./useConfirm";

/** 极简宿主：按一次按钮就问一次，把答复原样抛给测试。 */
function Harness({ onAnswer }: { onAnswer: (ok: boolean) => void }) {
  const { confirm, dialog } = useConfirm();
  return (
    <>
      <button
        type="button"
        onClick={async () => {
          const ok = await confirm({
            title: "移除来源",
            message: <span>确定移除？</span>,
            confirmText: "移除",
            danger: true,
          });
          onAnswer(ok);
        }}
      >
        问
      </button>
      {dialog}
    </>
  );
}

describe("useConfirm", () => {
  it("确认返回 true，取消返回 false", async () => {
    const onAnswer = vi.fn();
    render(<Harness onAnswer={onAnswer} />);

    await userEvent.click(screen.getByRole("button", { name: "问" }));
    let dialog = screen.getByRole("dialog", { name: "移除来源" });
    expect(dialog).toHaveTextContent("确定移除？");
    await userEvent.click(screen.getByRole("button", { name: "移除" }));
    expect(onAnswer).toHaveBeenCalledWith(true);
    expect(screen.queryByRole("dialog")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "问" }));
    dialog = screen.getByRole("dialog", { name: "移除来源" });
    await userEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(onAnswer).toHaveBeenLastCalledWith(false);
  });

  it("Esc 等同取消", async () => {
    const onAnswer = vi.fn();
    render(<Harness onAnswer={onAnswer} />);

    await userEvent.click(screen.getByRole("button", { name: "问" }));
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(onAnswer).toHaveBeenCalledWith(false));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  /// 旧问题被顶掉时必须以「取消」收尾，否则调用方 await 永远挂着。
  it("上一个问题未答复就被顶掉时，旧 Promise 以取消收尾", async () => {
    function Twice({ onFirst }: { onFirst: (ok: boolean) => void }) {
      const { confirm, dialog } = useConfirm();
      return (
        <>
          <button
            type="button"
            onClick={async () => onFirst(await confirm({ title: "第一个", message: "a" }))}
          >
            一
          </button>
          <button
            type="button"
            onClick={() => void confirm({ title: "第二个", message: "b" })}
          >
            二
          </button>
          {dialog}
        </>
      );
    }
    const onFirst = vi.fn();
    render(<Twice onFirst={onFirst} />);

    await userEvent.click(screen.getByRole("button", { name: "一" }));
    await userEvent.click(screen.getByRole("button", { name: "二" }));
    await waitFor(() => expect(onFirst).toHaveBeenCalledWith(false));
    expect(screen.getByRole("dialog", { name: "第二个" })).toBeInTheDocument();
  });
});
