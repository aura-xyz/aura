import { useEffect, useState, type ReactNode } from "react";
import { buildExampleCards, type ExampleCard } from "../lib/exampleCards";
import { listSkills } from "../lib/api";

/**
 * 开始界面（v0.7.0 重排）。
 *
 * 布局顺序：**图标 + 标题 → 输入框 → 示例内容**，整体居中成一块。
 *
 * 此前是「标题在消息区居中、输入框钉在窗口最底」，两块离得很远，
 * 视觉上像两个不相干的区域（用户实测反馈：「把对话框移到图标和标题下方，
 * 然后在输入框下方显示示例内容」）。
 *
 * 示例内容从内置技能**动态生成**（`buildExampleCards`），不是写死的文案——
 * 加了新技能，示例卡片自动跟着变。
 */
export default function StartScreen({
  children,
  onPick,
}: {
  /** 输入框（由外层传入，组件本身不管输入逻辑） */
  children: ReactNode;
  /** 点示例卡片：把引导语填进输入框 */
  onPick: (prompt: string) => void;
}) {
  const [cards, setCards] = useState<ExampleCard[]>([]);

  useEffect(() => {
    let cancelled = false;
    listSkills()
      .then((skills) => {
        if (!cancelled) setCards(buildExampleCards(skills));
      })
      .catch(() => {
        // 拿不到技能就只显示标题，不报错——开始界面不该有失败态
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto px-6 py-8">
      <div className="flex w-full max-w-2xl flex-col items-center">
        <img
          src="/logo.png"
          alt="Aura"
          draggable={false}
          className="h-14 w-14 select-none"
        />
        <h2 className="mt-3 text-2xl font-semibold tracking-[-0.03em]">Aura</h2>
        <p className="mt-1.5 text-sm text-subtle">
          Minimal surface. Maximum logic.
        </p>

        {/* 输入框：紧跟在标题下方 */}
        <div className="mt-6 w-full">{children}</div>

        {/* 示例内容：在输入框下方 */}
        {cards.length > 0 && (
          <div className="mt-6 flex w-full flex-wrap justify-center gap-2">
            {cards.map((c) => (
              <button
                key={c.name}
                type="button"
                onClick={() => onPick(c.prompt)}
                className="group flex max-w-[16rem] flex-col items-start gap-0.5 rounded-card border border-line bg-surface px-3 py-2 text-left transition-colors hover:border-brand"
              >
                <span className="text-sm font-medium transition-colors group-hover:text-brand">
                  {c.title}
                </span>
                <span className="line-clamp-2 text-xs text-subtle">
                  {c.subtitle}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
