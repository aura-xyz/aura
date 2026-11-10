import { describe, expect, it } from "vitest";
import {
  assembleChunks,
  directoryNotice,
  formatBytes,
  truncationNotice,
  type FileChunk,
} from "./filePreview";

const chunk = (index: number, text: string, done = false): FileChunk => ({
  index,
  text,
  done,
});

describe("assembleChunks", () => {
  it("按 index 拼接并忽略结束标记", () => {
    const parts = [chunk(0, "第一段"), chunk(2, "第三段"), chunk(1, "第二段"), chunk(3, "", true)];
    expect(assembleChunks(parts)).toBe("第一段第二段第三段");
  });

  it("中文跨块不会产生乱码", () => {
    expect(assembleChunks([chunk(0, "你好"), chunk(1, "，Aura")])).toBe("你好，Aura");
  });

  it("只有结束标记时返回空串", () => {
    expect(assembleChunks([chunk(0, "", true)])).toBe("");
  });
});

describe("截断提示", () => {
  it("字节数格式化", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatBytes(2 * 1024 * 1024)).toBe("2.00 MB");
  });

  it("未截断不提示", () => {
    expect(truncationNotice(1000, 1000)).toBeNull();
    expect(directoryNotice(10, 10)).toBeNull();
  });

  it("文件截断给出已读与总量", () => {
    const notice = truncationNotice(5 * 1024 * 1024, 2 * 1024 * 1024);
    expect(notice).toContain("2.00 MB");
    expect(notice).toContain("5.00 MB");
  });

  it("目录截断给出显示条数与总数", () => {
    const notice = directoryNotice(5000, 2000);
    expect(notice).toContain("2000");
    expect(notice).toContain("5000");
  });
});
