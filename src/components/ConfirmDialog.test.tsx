import { render, screen, fireEvent } from "@testing-library/react";
import ConfirmDialog from "./ConfirmDialog";

describe("ConfirmDialog", () => {
  const defaultProps = {
    title: "测试标题",
    children: <p>测试内容</p>,
    confirmText: "确认",
    onCancel: vi.fn(),
    onConfirm: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("渲染标题与内容", () => {
    render(<ConfirmDialog {...defaultProps} />);
    expect(screen.getByRole("dialog", { name: "测试标题" })).toBeInTheDocument();
    expect(screen.getByText("测试内容")).toBeInTheDocument();
  });

  it("显示确认与取消按钮", () => {
    render(<ConfirmDialog {...defaultProps} />);
    expect(screen.getByRole("button", { name: "确认" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "取消" })).toBeInTheDocument();
  });

  it("点击确认调用 onConfirm", () => {
    render(<ConfirmDialog {...defaultProps} />);
    fireEvent.click(screen.getByRole("button", { name: "确认" }));
    expect(defaultProps.onConfirm).toHaveBeenCalledTimes(1);
  });

  it("点击取消调用 onCancel", () => {
    render(<ConfirmDialog {...defaultProps} />);
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(defaultProps.onCancel).toHaveBeenCalledTimes(1);
  });

  it("点击遮罩关闭调用 onCancel", () => {
    render(<ConfirmDialog {...defaultProps} />);
    // 点击对话框外部（遮罩层）
    fireEvent.click(screen.getByTestId("overlay"));
    expect(defaultProps.onCancel).toHaveBeenCalledTimes(1);
  });

  it("busy=true 时禁用按钮且不触发回调", () => {
    render(<ConfirmDialog {...defaultProps} busy />);
    expect(screen.getByRole("button", { name: "确认" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "取消" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "确认" }));
    expect(defaultProps.onConfirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(defaultProps.onCancel).not.toHaveBeenCalled();
  });

  it("danger=true 时确认按钮显示危险色", () => {
    render(<ConfirmDialog {...defaultProps} danger />);
    const confirmBtn = screen.getByRole("button", { name: "确认" });
    expect(confirmBtn).toHaveClass("bg-danger");
  });

  it("自定义取消按钮文案", () => {
    render(<ConfirmDialog {...defaultProps} cancelText="关闭" />);
    // 取消按钮通过文本内容查找，避免与关闭图标按钮的 aria-label 冲突
    expect(screen.getByText("关闭")).toBeInTheDocument();
  });

  it("Esc 键关闭对话框", () => {
    render(<ConfirmDialog {...defaultProps} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(defaultProps.onCancel).toHaveBeenCalledTimes(1);
  });
});