/**
 * 设置面板（v0.8.0，参照 dsh ui-settings-general/SettingsRoot）。
 *
 * 此前是整页替换对话区；现在改成 portal 模态，底层对话保持可见。
 * 分区由 settingsSections 注册表派生，窄屏时 nav rail 转成横向条。
 */
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { listen } from "@tauri-apps/api/event";
import { X } from "lucide-react";
import type { useTheme } from "../hooks/useTheme";
import { getGlobalRules } from "../lib/api";
import { settingsSections } from "../lib/settingsSections";
import AboutSection from "./AboutSection";
import AppearanceSection from "../components/AppearanceSection";
import GeneralSection from "../components/GeneralSection";
import ModelSection from "../components/ModelSection";

interface Props {
  onClose: () => void;
  theme: ReturnType<typeof useTheme>;
}

export default function SettingsPage({ onClose, theme }: Props) {
  const [section, setSection] = useState<string>(
    () => settingsSections()[0]?.id ?? "appearance",
  );
  const [rules, setRules] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const un = listen<{
      provider: string;
      status: string;
      percent: number | null;
    }>("ollama_pull", () => {
      /* ModelSection 自行处理 ollama_pull，此处无需订阅 */
    });
    return () => {
      un.then((f) => f());
    };
  }, []);

  useEffect(() => {
    void getGlobalRules().then(setRules).catch(() => {});
  }, []);

  useEffect(() => {
    function onKey(e: globalThis.KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/25"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="设置"
        className="flex h-[min(82vh,660px)] w-[min(92vw,900px)] flex-col overflow-hidden rounded-card border border-line bg-surface shadow-xl max-md:h-[92vh]"
      >
        <header className="flex shrink-0 items-center justify-between border-b border-line px-5 py-3">
          <h1 className="text-base font-semibold tracking-[-0.02em]">设置</h1>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭设置"
            title="关闭设置"
            className="rounded-tag p-1 text-subtle transition-colors hover:bg-bubble hover:text-foreground"
          >
            <X size={15} aria-hidden />
          </button>
        </header>

        <div className="flex min-h-0 flex-1 max-md:flex-col">
          <nav
            aria-label="设置分区"
            className="w-36 shrink-0 overflow-y-auto border-r border-line p-3 max-md:flex max-md:w-full max-md:shrink max-md:gap-1 max-md:overflow-x-auto max-md:border-b max-md:border-r-0 max-md:p-2"
          >
            {settingsSections().map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setSection(s.id)}
                aria-current={section === s.id ? "page" : undefined}
                className={`w-full rounded-tag px-3 py-1.5 text-left text-sm transition-colors max-md:w-auto max-md:shrink-0 max-md:whitespace-nowrap ${
                  section === s.id
                    ? "bg-bubble font-medium text-foreground"
                    : "text-subtle hover:bg-bubble hover:text-foreground"
                }`}
              >
                {s.label}
              </button>
            ))}
          </nav>

          <div className="min-w-0 flex-1 overflow-y-auto p-6">
            {section === "appearance" && <AppearanceSection theme={theme} />}
            {section === "model" && <ModelSection />}
            {section === "general" && (
              <GeneralSection
                rules={rules}
                setRules={setRules}
                saved={saved}
                setSaved={setSaved}
              />
            )}
            {section === "about" && <AboutSection />}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
