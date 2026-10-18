import type { LucideIcon } from "lucide-react";
import { ArrowLeft } from "lucide-react";

interface Props {
  title: string;
  /** 一句话说明这个页面将来做什么，展示在标题下方 */
  description: string;
  /** 预留期的能力清单。下一阶段落地时逐条替换为真实实现 */
  planned: string[];
  icon: LucideIcon;
  onClose: () => void;
}

/**
 * 尚未实现的功能页共用外壳。
 *
 * 侧边栏已给出 Skills / MCP 的正式入口，页面骨架（返回、标题、版式）
 * 与设置页保持一致；等各自功能落地时，只需把 `planned` 换成真实内容，
 * 不用再回头调布局。
 */
export default function PlaceholderPage({
  title,
  description,
  planned,
  icon: Icon,
  onClose,
}: Props) {
  return (
    <div className="mx-auto max-w-2xl px-8 py-10">
      <button
        type="button"
        onClick={onClose}
        className="flex items-center gap-2 text-sm text-subtle transition-colors hover:text-foreground"
      >
        <ArrowLeft size={15} />
        返回对话
      </button>

      <div className="mt-5 flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-tag border border-line bg-surface text-subtle">
          <Icon size={18} />
        </span>
        <h1 className="text-2xl font-semibold leading-tight tracking-[-0.03em]">
          {title}
        </h1>
      </div>

      <p className="mt-3 text-sm leading-relaxed text-subtle">{description}</p>

      <div className="mt-8 rounded-card border border-line bg-surface p-5">
        <h2 className="eyebrow">规划中的能力</h2>
        <ul className="mt-4 space-y-2.5">
          {planned.map((p) => (
            <li key={p} className="flex items-start gap-2.5 text-sm">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-line" />
              <span className="leading-relaxed text-subtle">{p}</span>
            </li>
          ))}
        </ul>
        <p className="mt-5 border-t border-line pt-4 text-xs text-subtle">
          本阶段为入口预留，功能尚未实现。
        </p>
      </div>
    </div>
  );
}