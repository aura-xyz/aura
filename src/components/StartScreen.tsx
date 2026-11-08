import { useEffect, useState, type ReactNode } from "react";
import { History } from "lucide-react";
import { buildExampleCards, type ExampleCard } from "../lib/exampleCards";
import { skillInitial } from "../lib/skill";
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
  recentSession,
  modelLabel,
}: {
  /** 输入框（由外层传入，组件本身不管输入逻辑） */
  children: ReactNode;
  /** 点示例卡片：把引导语填进输入框 */
  onPick: (prompt: string) => void;
  /** 最近一条会话：给了就显示「继续上次」直达胶囊 */
  recentSession?: { title: string; onOpen: () => void };
  /** 当前模型名：给了就在 slogan 下补一枚徽章 */
  modelLabel?: string;
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
    <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-y-auto px-6 py-8">
      {/* 输入框后方的极淡品牌色光晕：给首屏一点纵深，不抢内容 */}
      <div className="aura-start-glow" aria-hidden />

      <div className="relative flex w-full max-w-2xl flex-col items-center">
        <img
          src="/logo.png"
          alt="Aura"
          draggable={false}
          className={`h-14 w-14 select-none ${playLogoIntro() ? "aura-logo-in" : ""}`}
        />
        <h2 className="mt-3 text-2xl font-semibold tracking-[-0.03em]">Aura</h2>
        <p className="mt-1.5 text-sm text-subtle">
          Minimal surface. Maximum logic.
        </p>
        {modelLabel && (
          <span className="mt-2 rounded-full border border-line px-2 py-0.5 text-[11px] text-subtle">
            {modelLabel}
          </span>
        )}

        {/* 输入框：紧跟在标题下方 */}
        <div className="mt-6 w-full">{children}</div>

        {recentSession && (
          <button
            type="button"
            onClick={recentSession.onOpen}
            className="mt-4 flex max-w-full items-center gap-2 rounded-full border border-line bg-surface px-3 py-1.5 text-xs text-subtle transition-colors hover:border-brand hover:text-foreground"
          >
            <History size={12} aria-hidden className="shrink-0" />
            <span className="shrink-0">继续上次</span>
            <span className="min-w-0 truncate font-medium text-foreground">
              {recentSession.title}
            </span>
          </button>
        )}

        {/* 示例内容：在输入框下方，双列网格自然排成两行 */}
        {cards.length > 0 && (
          <div className="mt-6 grid w-full grid-cols-1 gap-2 sm:grid-cols-2">
            {cards.map((c) => (
              <button
                key={c.name}
                type="button"
                onClick={() => onPick(c.prompt)}
                className="group flex flex-col items-start gap-1 rounded-card border border-line border-t-2 border-t-brand bg-surface px-3 py-2 text-left shadow-sm transition-colors hover:border-brand"
              >
                <span className="flex items-center gap-1.5">
                  <span
                    aria-hidden
                    className="flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] bg-brand/10 text-[9px] font-semibold text-brand"
                  >
                    {skillInitial(c.title)}
                  </span>
                  <span className="text-sm font-medium transition-colors group-hover:text-brand">
                    {c.title}
                  </span>
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

/**
 * logo 入场只在本次应用会话里播一次。
 *
 * 开始界面每次新建对话都会重新挂载，动画跟着重播会显得拖沓；
 * 用模块级标记把「首次」限定在这一进程内，刷新页面自然重来。
 */
let logoIntroPlayed = false;
function playLogoIntro(): boolean {
  if (logoIntroPlayed) return false;
  logoIntroPlayed = true;
  return true;
}
