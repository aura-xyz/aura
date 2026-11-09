/**
 * 外观设置区块：主题三档 + 三角色字号。
 *
 * 此前只画亮/暗两个按钮，而 useTheme 已经支持 system 与 text/code/terminal
 * 三档字号 —— 数据模型有、界面没有入口，等于功能不存在。
 */
import {
  ACCENTS,
  ACCENT_IDS,
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
} from "../lib/theme";
import { saveMarkdownLive } from "../lib/markdownLive";
import { useMarkdownLive } from "../hooks/useMarkdownLive";
import { Check, RotateCcw } from "lucide-react";

type ThemeApi = ReturnType<typeof import("../hooks/useTheme").useTheme>;

/**
 * 12px 主题预览小方块：半边亮半边暗，跟随系统用 45° 斜分。
 * 纯 CSS，不引图片；描边用 ring 保证在亮暗两种背景下都能看见边界。
 */
function ThemeSwatch({ id }: { id: ThemeApi["theme"] }) {
  if (id === "system") {
    return (
      <span
        aria-hidden
        className="aura-theme-swatch-system h-3 w-3 shrink-0 rounded-[3px] ring-1 ring-line"
      />
    );
  }
  return (
    <span
      aria-hidden
      className="relative h-3 w-3 shrink-0 overflow-hidden rounded-[3px] ring-1 ring-line"
    >
      <span className="absolute inset-y-0 left-0 w-1/2 bg-white" />
      <span className="absolute inset-y-0 right-0 w-1/2 bg-[#1c1c1e]" />
    </span>
  );
}

const THEMES: { id: ThemeApi["theme"]; label: string }[] = [
  { id: "light", label: "亮色" },
  { id: "dark", label: "暗色" },
  { id: "system", label: "跟随系统" },
];

export default function AppearanceSection({ theme }: { theme: ThemeApi }) {
  const markdownLive = useMarkdownLive();
  const fontRows: {
    label: string;
    value: number;
    onChange: (px: number) => void;
  }[] = [
    { label: "正文", value: theme.fontSize, onChange: theme.setFontSize },
    { label: "代码", value: theme.codeFontSize, onChange: theme.setCodeFontSize },
    { label: "终端", value: theme.terminalFontSize, onChange: theme.setTerminalFontSize },
  ];

  return (
    <section className="rounded-card border border-line p-6">
      <h2 className="eyebrow">外观</h2>

      <div className="mt-4 flex items-center justify-between gap-3">
        <span className="text-sm font-medium">主题</span>
        <div
          role="group"
          aria-label="主题"
          className="flex rounded-full border border-line p-0.5"
        >
          {THEMES.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => theme.setTheme(t.id)}
              aria-pressed={theme.theme === t.id}
              className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-sm transition-colors ${
                theme.theme === t.id
                  ? "bg-brand text-white"
                  : "text-subtle hover:text-foreground"
              }`}
            >
              <ThemeSwatch id={t.id} />
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* 强调色：五档覆盖 --brand / --link / --bubble-user，
          色值全部过了对比度门禁（见 contrast.test） */}
      <div className="mt-6 flex items-center justify-between gap-3">
        <span className="text-sm font-medium">强调色</span>
        <div role="group" aria-label="强调色" className="flex items-center gap-2">
          {ACCENT_IDS.map((id) => {
            const selected = theme.accent === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => theme.setAccent(id)}
                aria-label={ACCENTS[id].label}
                aria-pressed={selected}
                title={`强调色：${ACCENTS[id].label}`}
                style={{ backgroundColor: ACCENTS[id].light.brand }}
                className={`flex h-6 w-6 items-center justify-center rounded-full transition-transform hover:scale-110 ${
                  selected ? "ring-2 ring-offset-2 ring-offset-surface" : ""
                }`}
              >
                {selected && (
                  <Check size={12} className="text-white" aria-hidden />
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-6 flex items-center justify-between gap-3">
        <span className="text-sm font-medium">字号</span>
        <button
          type="button"
          onClick={theme.resetFontSizes}
          aria-label="恢复默认字号"
          title="恢复默认字号"
          className="flex items-center gap-1 rounded-tag border border-line px-2 py-1 text-xs text-subtle transition-colors hover:border-brand hover:text-foreground"
        >
          <RotateCcw size={12} aria-hidden />
          恢复默认
        </button>
      </div>

      <div className="mt-3 flex flex-col gap-3">
        {fontRows.map((row) => (
          <label key={row.label} className="flex items-center gap-3 text-sm">
            <span className="w-20 shrink-0">{row.label}字号</span>
            <input
              type="range"
              min={FONT_SIZE_MIN}
              max={FONT_SIZE_MAX}
              step={1}
              value={row.value}
              aria-label={`${row.label}字号`}
              onChange={(e) => row.onChange(Number(e.currentTarget.value))}
              className="min-w-0 flex-1"
            />
            <span className="w-12 text-right tabular-nums text-subtle">
              {row.value}px
            </span>
          </label>
        ))}
      </div>
      <p className="mt-3 text-xs leading-relaxed text-subtle">
        正文字号作用于对话消息，代码字号作用于代码块；终端字号作用于工具输出等宽文本。
      </p>

      <div className="mt-6 flex items-center justify-between gap-3 border-t border-line pt-5">
        <div className="min-w-0">
          <span className="text-sm font-medium">输入框 Markdown 实时渲染</span>
          <p className="mt-1 text-xs leading-relaxed text-subtle">
            输入 #、**、``` 等语法时即时显示排版；关闭后回到纯文本输入。发出的仍是原始 Markdown。
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-label="输入框 Markdown 实时渲染"
          aria-checked={markdownLive}
          onClick={() => saveMarkdownLive(!markdownLive)}
          className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
            markdownLive ? "bg-brand" : "bg-bubble"
          }`}
        >
          <span
            className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow-sm transition-all ${
              markdownLive ? "left-6" : "left-1"
            }`}
          />
        </button>
      </div>
    </section>
  );
}
