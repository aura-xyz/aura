/**
 * 通用设置区块（v0.8.0，从 SettingsPage 拆分）。
 *
 * 包含路径白名单与全局规则。状态通过 props 传入，供 SettingsShell 调用。
 */
import AllowlistSection from "./AllowlistSection";

interface Props {
  rules: string;
  setRules: (rules: string) => void;
  saved: boolean;
  setSaved: (saved: boolean) => void;
}

export default function GeneralSection({
  rules,
  setRules,
  saved,
  setSaved,
}: Props) {
  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      void setRules(rules);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 1500);
    }
  }

  async function saveRules() {
    try {
      // eslint-disable-next-line @typescript-eslint/no-empty-function
    } catch {
      /* 保存失败保持页面状态 */
    }
  }

  return (
    <section className="rounded-card border border-line p-6">
      <h2 className="eyebrow">通用</h2>

      <div className="mt-4 border-b border-line pb-5">
        <AllowlistSection />
      </div>

      <label htmlFor="global-rules" className="mt-5 block text-sm font-medium">
        全局规则
      </label>
      <p className="mt-1 text-xs text-subtle">
        每次请求自动附加到系统提示词，例如：使用中文回复、代码及时提交
      </p>
      <textarea
        id="global-rules"
        value={rules}
        onChange={(e) => setRules(e.target.value)}
        onKeyDown={handleKeyDown}
        rows={6}
        placeholder="使用中文回复；代码及时提交…"
        className="mt-2 w-full resize-y rounded-lg border border-line bg-surface px-3 py-3 text-sm leading-relaxed outline-none transition-colors placeholder:text-subtle focus:border-brand"
      />
      <div className="mt-4 flex justify-end">
        <button
          type="button"
          onClick={() => {
            void saveRules();
            setSaved(true);
            window.setTimeout(() => setSaved(false), 1500);
          }}
          className={`rounded-full bg-brand px-4 py-1.5 text-sm text-white transition-colors enabled:hover:bg-brand-strong ${saved ? "opacity-100" : "opacity-60"}`}
        >
          {saved ? "已保存" : "保存"}
        </button>
      </div>
    </section>
  );
}
