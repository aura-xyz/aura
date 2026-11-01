/**
 * 外观设置区块（v0.8.0，从 SettingsPage 拆分）。
 *
 * 接收 theme/setTheme 通过 props，供 SettingsShell 调用。
 */
import type { Theme } from "../hooks/useTheme";

interface Props {
  theme: Theme;
  setTheme: (theme: Theme) => void;
}

export default function AppearanceSection({ theme, setTheme }: Props) {
  return (
    <section className="rounded-card border border-line p-6">
      <h2 className="eyebrow">外观</h2>
      <div className="mt-4 flex items-center justify-between">
        <span className="text-sm font-medium">主题</span>
        <div className="flex rounded-full border border-line p-0.5">
          <button
            type="button"
            onClick={() => setTheme("light")}
            className={`rounded-full px-4 py-1 text-sm transition-colors ${
              theme === "light"
                ? "bg-brand text-white"
                : "text-subtle hover:text-foreground"
            }`}
          >
            亮色
          </button>
          <button
            type="button"
            onClick={() => setTheme("dark")}
            className={`rounded-full px-4 py-1 text-sm transition-colors ${
              theme === "dark"
                ? "bg-brand text-white"
                : "text-subtle hover:text-foreground"
            }`}
          >
            暗色
          </button>
        </div>
      </div>
    </section>
  );
}
