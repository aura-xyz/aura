import { Target, X } from "lucide-react";
import { CONTENT_WIDTH } from "../lib/layout";
import AlertBar from "./AlertBar";

/**
 * 长期目标条（`/goal`）。只展示与清除，不自动续跑——
 * 目标由后端在每轮 system prompt 里注入，界面这条只是让用户看得见、
 * 随时能改，避免出现「设了目标却不知道有没有生效」。
 *
 * v0.8.0：外观交给 AlertBar，与编辑提示条共用同一套横幅语言。
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
    <AlertBar
      variant="info"
      className={`mx-auto mb-2 ${CONTENT_WIDTH}`}
      icon={<Target size={13} />}
      action={
        <button
          type="button"
          onClick={onClear}
          aria-label="清除长期目标"
          title="清除长期目标"
          className="rounded-md px-1 text-subtle transition-colors hover:text-foreground"
        >
          <X size={12} aria-hidden />
        </button>
      }
    >
      <button
        type="button"
        onClick={onEdit}
        title="点击编辑长期目标"
        className="block w-full truncate text-left text-foreground"
      >
        <span className="mr-1.5 text-subtle">长期目标</span>
        {goal}
      </button>
    </AlertBar>
  );
}
