import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * v0.8.1 P06 的前端契约：后端换成「结构 + 截断标记」后，面板必须把
 * 截断明确告诉用户，而不是静默少显示一堆条目 / 半截文件。
 */
vi.mock("../lib/api", () => ({
  listDirectory: vi.fn(),
  readFileStream: vi.fn(),
}));

import { listDirectory, readFileStream } from "../lib/api";
import { FileBrowserPanel } from "./FileBrowserPanel";

const ONE_FILE = [
  { name: "a.txt", path: "/a.txt", is_dir: false, size: 12, modified_ms: 0 },
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listDirectory).mockResolvedValue({
    entries: ONE_FILE,
    truncated: false,
    total: 1,
  });
  vi.mocked(readFileStream).mockResolvedValue({
    content: "文件内容",
    truncated: false,
    total_bytes: 12,
    sent_bytes: 12,
  });
});

describe("FileBrowserPanel 截断提示", () => {
  it("未截断时不显示任何提示", async () => {
    render(<FileBrowserPanel sessionId="s1" />);
    await waitFor(() => expect(listDirectory).toHaveBeenCalled());
    expect(screen.queryByText(/目录条目过多/)).toBeNull();
  });

  it("目录超过上限时显示真实总数与已显示条数", async () => {
    vi.mocked(listDirectory).mockResolvedValue({
      entries: ONE_FILE,
      truncated: true,
      total: 5000,
    });
    render(<FileBrowserPanel sessionId="s1" />);
    expect(await screen.findByText(/目录条目过多/)).toHaveTextContent("5000");
  });

  it("大文件被截断时显示已预览量与总量", async () => {
    vi.mocked(readFileStream).mockResolvedValue({
      content: "前 2MB 内容",
      truncated: true,
      total_bytes: 5 * 1024 * 1024,
      sent_bytes: 2 * 1024 * 1024,
    });
    render(<FileBrowserPanel sessionId="s1" />);
    await waitFor(() => expect(listDirectory).toHaveBeenCalled());
    await userEvent.click(await screen.findByRole("button", { name: /a\.txt/ }));
    const notice = await screen.findByText(/文件较大，仅预览前/);
    expect(notice).toHaveTextContent("2.00 MB");
    expect(notice).toHaveTextContent("5.00 MB");
  });
});
