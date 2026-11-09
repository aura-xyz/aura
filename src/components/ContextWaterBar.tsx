/**
 * 上下文水位条（v0.8.0）。
 *
 * 80px 微型条 + 百分比：用户猜不到「还要聊多久会撞窗口」，这个数字给个提前量。
 * 数据全部来自后端 usage 与模型目录的 context_limit，不做任何估算；
 * 任一值缺失就整块不渲染，宁可没有也不画一个假的进度。
 */
import { useStore } from "../store";
import { waterHint, waterLevel } from "../lib/contextWater";

export function ContextWaterBar({
  contextLimit,
}: {
  /** 当前模型窗口上限；未知传 undefined */
  contextLimit?: number;
}) {
  let session;
  try {
    session = useStore().activeSession;
  } catch {
    return null;
  }
  if (!session) return null;

  const level = waterLevel(session.lastUsage?.input ?? null, contextLimit);
  if (!level) return null;

  const fill =
    level.stage === "crit"
      ? "bg-danger"
      : level.stage === "warn"
        ? "bg-warning"
        : "bg-brand";

  return (
    <span
      className="flex items-center gap-1.5"
      title={waterHint(level)}
      aria-label={`上下文水位 ${level.percent}%`}
    >
      <span
        role="progressbar"
        aria-valuenow={level.percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="上下文水位"
        className="h-1 w-20 overflow-hidden rounded-full bg-bubble"
      >
        <span
          className={`block h-full rounded-full transition-[width] duration-300 ${fill}`}
          style={{ width: `${level.percent}%` }}
        />
      </span>
      <span
        className={`text-[11px] tabular-nums ${
          level.stage === "ok" ? "text-subtle" : "text-foreground"
        }`}
      >
        {level.percent}%
      </span>
    </span>
  );
}
