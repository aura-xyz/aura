import { describe, expect, it } from "vitest";
import { unzipSync } from "fflate";
import {
  bundleEntries,
  exportFileName,
  zipBundle,
} from "./exportBundle";

describe("导出 ZIP", () => {
  it("三件套文件名与内容固定", () => {
    const entries = bundleEntries({
      conversation_md: "# 会话",
      timeline_md: "# 时间线",
      updater_log: "log",
    });
    expect(Object.keys(entries).sort()).toEqual([
      "conversation.md",
      "timeline.md",
      "updater.log",
    ]);
    expect(new TextDecoder().decode(entries["conversation.md"])).toBe("# 会话");
  });

  it("会话 id 收敛成安全文件名", () => {
    expect(exportFileName("abc-123")).toBe("aura-session-abc-123.zip");
    // 全是非安全字符时退化成固定名，不要产出 "aura-session-.zip"
    expect(exportFileName("会话/带:冒号")).toBe("aura-session-current.zip");
  });

  it("zip 内三个文件都能读回原文", () => {
    const bytes = zipBundle({
      conversation_md: "# 会话\n\n> 你好",
      timeline_md: "# 时间线",
      updater_log: "log line",
    });
    const files = unzipSync(bytes);
    expect(Object.keys(files).sort()).toEqual([
      "conversation.md",
      "timeline.md",
      "updater.log",
    ]);
    expect(new TextDecoder().decode(files["conversation.md"])).toContain("你好");
    expect(new TextDecoder().decode(files["updater.log"])).toBe("log line");
  });
});
