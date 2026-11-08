import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  dismissNotice,
  NOTICE_TTL_MS,
  noticesSnapshot,
  notify,
  resetNotices,
  subscribeNotices,
} from "./notices";

beforeEach(() => resetNotices());

afterEach(() => {
  vi.useRealTimers();
  resetNotices();
});

describe("notices", () => {
  it("按顺序堆叠，成功与失败各带自己的类型", () => {
    notify("ok", "已导出");
    notify("error", "导出失败：磁盘满");

    expect(noticesSnapshot().map((n) => [n.kind, n.text])).toEqual([
      ["ok", "已导出"],
      ["error", "导出失败：磁盘满"],
    ]);
  });

  it("到期自动消失", () => {
    vi.useFakeTimers();
    notify("ok", "已复制");
    expect(noticesSnapshot()).toHaveLength(1);

    vi.advanceTimersByTime(NOTICE_TTL_MS - 1);
    expect(noticesSnapshot()).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(noticesSnapshot()).toEqual([]);
  });

  /// 手动关闭时计时器必须一起清掉，否则到期会再触发一次无意义的 emit。
  it("手动关闭只移除指定的一条，并通知订阅者", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeNotices(listener);
    const first = notify("ok", "一");
    notify("ok", "二");

    dismissNotice(first);
    expect(noticesSnapshot().map((n) => n.text)).toEqual(["二"]);
    expect(listener).toHaveBeenCalledTimes(3); // 两次入队 + 一次关闭

    unsubscribe();
    notify("ok", "三");
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it("重复关闭同一条不报错也不触发多余通知", () => {
    const id = notify("ok", "一");
    dismissNotice(id);
    const listener = vi.fn();
    subscribeNotices(listener);
    dismissNotice(id);
    expect(listener).not.toHaveBeenCalled();
  });

  /// useSyncExternalStore 依赖「引用不变 = 没变化」，每次返回新数组会死循环。
  it("快照引用只在内容变化时更换", () => {
    const before = noticesSnapshot();
    expect(noticesSnapshot()).toBe(before);
    notify("ok", "一");
    expect(noticesSnapshot()).not.toBe(before);
  });
});
