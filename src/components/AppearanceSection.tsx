/**
 * 外观设置区块：主题三档 + 三角色字号。
 *
 * 此前只画亮/暗两个按钮，而 useTheme 已经支持 system 与 text/code/terminal
 * 三档字号 —— 数据模型有、界面没有入口，等于功能不存在。
 */
import { FONT_SIZE_MAX, FONT_SIZE_MIN } from "../lib/theme";
import { RotateCcw } from "lucide-react";

type ThemeApi = ReturnType<typeof import("../hooks/useTheme").useTheme>;

const THEMES: { id: ThemeApi["theme"]; label: string }[] = [
  { id: "light", label: "亮色" },
  { id: "dark", label: "暗色" },
  { id: "system", label: "跟随系统" },
];

export default function AppearanceSection({ theme }: { theme: ThemeApi }) {
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
              className={`rounded-full px-4 py-1 text-sm transition-colors ${
                theme.theme === t.id
                  ? "bg-brand text-white"
                  : "text-subtle hover:text-foreground"
              }`}
            >
              {t.label}
            </button>
          ))}
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
    </section>
  );
}
