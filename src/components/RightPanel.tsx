import { useState } from "react";
import { PanelRightClose, PanelRightOpen } from "lucide-react";
import { useStore } from "../store";
import { showsTodoPanel } from "../lib/mode";
import TodoPanel from "./TodoPanel";

const COLLAPSE_KEY = "aura-right-panel-collapsed";

/**
 * 右侧任务面板栏。
 *
 * 此前清单放在左侧侧边栏，与会话列表挤在一起，且多个会话各有清单时
 * 难以区分归属。移到右侧独立栏后：
 *
 * - 位置固定，不随对话流滚动，长任务不用向上翻找
 * - 只显示**当前会话**的清单，归属明确
 * - 与会话列表分离，两者不再互相挤占空间
 *
 * **右侧永远有东西可看。**
 *
 * v0.6.3 的实现是「无内容就整块 `return null`」，于是对话模式（最常见的
 * 场景）下右侧整条边消失，用户会以为应用没有右栏（实测反馈：
 * 「右侧边栏没有显示」）。现在改成三态：
 *
 * | localStorage | 表现 |
 * |---|---|
 * | 无（默认） | 有清单 → 宽面板；无清单 → 窄轨道 |
 * | `"1"` | 窄轨道 |
 * | `"0"` | 宽面板（无清单时显示空状态说明） |
 *
 * 用户只感知两个动作：展开 / 收起。
 */
export default function RightPanel() {
  const { sessions, activeId, mode, deleteTodoStep, addTodoStep, setTodoStatus } =
    useStore();
  // "1" = 收起，"0" = 展开，未设置 = 自动（有内容展开、无内容只留窄条）
  const [pref, setPref] = useState(() => localStorage.getItem(COLLAPSE_KEY));

  const activeSession = sessions.find((s) => s.id === activeId);
  const todos = activeSession?.todos ?? [];
  const hasContent = showsTodoPanel(mode, todos.length);

  const collapsed = pref === "1";
  const forcedWide = pref === "0";
  /** 宽面板：有内容且用户没收起，或用户明确展开过 */
  const wide = forcedWide || (hasContent && !collapsed);

  function toggle() {
    // 宽 → 收起；窄 → 展开
    const next = wide ? "1" : "0";
    localStorage.setItem(COLLAPSE_KEY, next);
    setPref(next);
  }

  if (!wide) {
    return (
      <aside
        className="flex w-11 shrink-0 flex-col items-center border-l border-line"
        aria-label="任务面板"
      >
        <button
          type="button"
          onClick={toggle}
          aria-label="展开任务面板"
          title="展开任务面板"
          className="mt-3 rounded-tag p-1.5 text-subtle transition-colors hover:bg-bubble hover:text-foreground"
        >
          <PanelRightOpen size={14} />
        </button>
        <span
          className="mt-2 text-[10px] text-subtle tabular-nums"
          style={{ writingMode: "vertical-rl" }}
        >
          任务 {todos.length}
        </span>
      </aside>
    );
  }

  return (
    <aside
      className="flex w-64 shrink-0 flex-col overflow-y-auto border-l border-line"
      aria-label="任务面板"
    >
      <button
        type="button"
        onClick={toggle}
        aria-label="收起任务面板"
        title="收起任务面板"
        className="mx-3 mt-3 mb-1 flex items-center gap-1.5 rounded-tag px-1.5 py-1 text-left text-[11px] font-medium tracking-[0.08em] text-subtle transition-colors hover:bg-bubble"
      >
        <PanelRightClose size={12} aria-hidden />
        任务面板
      </button>
      {hasContent ? (
        <TodoPanel
          todos={todos}
          onDeleteStep={deleteTodoStep}
          onToggleStep={setTodoStatus}
          onAddStep={addTodoStep}
        />
      ) : (
        /* 明确展开但当前会话没有清单：给一句说明，别让用户以为面板坏了 */
        <div className="px-4 py-6 text-center">
          <p className="text-xs text-subtle">当前会话没有任务清单</p>
          <p className="mt-1.5 text-[11px] leading-relaxed text-subtle">
            切到 Plan / Build 模式，或让模型先产出计划，清单会出现在这里。
          </p>
        </div>
      )}
    </aside>
  );
}
