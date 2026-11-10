/**
 * 右栏「任务」面板的**内容体**（v0.8.0）。
 *
 * 外壳（tab 行、宽度、折叠、右上按钮）由 App.tsx 的新右栏统一管理。
 * 旧实现自带 aside + w-64 + border-l + 「任务面板」标题按钮 + 一条带
 * PanelRight 图标和竖排「任务 N」的窄轨道，嵌进新右栏后就变成：
 * 重复的标题栏、固定 256px 宽导致空状态说明文字相对整个右栏偏左、
 * 以及右栏拖窄时露出的旧按钮残留（实测反馈）。这里只留内容。
 */
import { useStore } from "../store";
import TodoPanel from "./TodoPanel";

export default function RightPanel() {
  const { sessions, activeId, deleteTodoStep, addTodoStep, setTodoStatus } =
    useStore();
  const activeSession = sessions.find((s) => s.id === activeId);
  const todos = activeSession?.todos ?? [];

  // 点开「任务」tab 就是为了看清单，不再用 showsTodoPanel 把 chat 模式
  // 下已有的清单藏起来；整块用 flex 居中，宽度跟随右栏而非固定 w-64。
  if (todos.length === 0) {
    return (
      <div
        aria-label="任务面板"
        className="flex h-full w-full flex-col items-center justify-center px-6 py-10 text-center"
      >
        <p className="text-xs text-subtle">当前会话没有任务清单</p>
        <p className="mt-1.5 max-w-[240px] text-[11px] leading-relaxed text-subtle">
          切到 Plan / Build 模式，或让模型先产出计划，清单会出现在这里。
        </p>
      </div>
    );
  }

  return (
    <TodoPanel
      todos={todos}
      onDeleteStep={deleteTodoStep}
      onToggleStep={setTodoStatus}
      onAddStep={addTodoStep}
    />
  );
}
