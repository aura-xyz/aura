import { Target, X } from "lucide-react";

/**
 * 长期目标条（`/goal`）。只展示与清除，不自动续跑——
 * 目标由后端在每轮 system prompt 里注入，界面这条只是让用户看得见、
 * 随时能改，避免出现「设了目标却不知道有没有生效」。
 */
export default function GoalBar({
  goal,
  onEdit,
  onClear,
}: {
  goal: string;
  onEdit: () => void;
  onClear: () => void;
}) {
  if (!goal) return null;
  return (
    <div className="mx-auto mb-2 flex w-full max-w-4xl xl:max-w-5xl 2xl:max-w-6xl items-start gap-2 rounded-tag border border-brand/40 bg-bubble px-3 py-1.5 text-xs">
      <Target size={13} className="mt-0.5 shrink-0 text-brand" aria-hidden />
      <button
        type="button"
        onClick={onEdit}
        title="点击编辑长期目标"
        className="min-w-0 flex-1 truncate text-left text-foreground"
      >
        <span className="mr-1.5 text-subtle">长期目标</span>
        {goal}
      </button>
      <button
        type="button"
        onClick={onClear}
        aria-label="清除长期目标"
        title="清除长期目标"
        className="shrink-0 rounded-md px-1 text-subtle transition-colors hover:text-foreground"
      >
        <X size={12} aria-hidden />
      </button>
    </div>
  );
}
