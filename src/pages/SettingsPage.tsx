/**
 * 设置页（整页形态）。
 *
 * 分区仍由 settingsSections 注册表派生，外观分区里的「恢复默认字号」保留；
 * 按用户要求从上一版的 portal 模态改回整页，打开时替换对话区。
 */
import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  ArrowLeft,
  Cpu,
  Info,
  Palette,
  ShieldCheck,
  SlidersHorizontal,
  type LucideIcon,
} from "lucide-react";
import type { useTheme } from "../hooks/useTheme";
import { getGlobalRules } from "../lib/api";
import { settingsSections } from "../lib/settingsSections";
import AboutSection from "./AboutSection";
import AppearanceSection from "../components/AppearanceSection";
import GeneralSection from "../components/GeneralSection";
import SecuritySection from "../components/SecuritySection";
import ModelSection from "../components/ModelSection";

/** 分区图标：与左栏导航同语言（15px，未选中 subtle，选中随文字变深）。 */
const SECTION_ICONS: Record<string, LucideIcon> = {
  appearance: Palette,
  model: Cpu,
  general: SlidersHorizontal,
  security: ShieldCheck,
  about: Info,
};

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

  return (
    <div className="min-h-full bg-surface">
      <div className="mx-auto w-full max-w-4xl px-8 py-8 xl:max-w-5xl">
        <button
          type="button"
          onClick={onClose}
          className="flex items-center gap-2 text-sm text-subtle transition-colors hover:text-foreground"
        >
          <ArrowLeft size={15} />
          返回对话
        </button>

        <h1 className="mt-5 text-2xl font-semibold leading-tight tracking-[-0.03em]">
          设置
        </h1>

        <div className="mt-6 flex gap-6">
          <nav aria-label="设置分区" className="w-36 shrink-0">
            <ul className="space-y-0.5">
              {settingsSections().map((s) => {
                const Icon = SECTION_ICONS[s.id];
                return (
                  <li key={s.id}>
                    <button
                      type="button"
                      onClick={() => setSection(s.id)}
                      aria-current={section === s.id ? "page" : undefined}
                      className={`flex w-full items-center gap-2 rounded-tag px-2.5 py-1.5 text-left text-sm transition-colors ${
                        section === s.id
                          ? "bg-bubble font-medium text-foreground"
                          : "text-subtle hover:bg-bubble hover:text-foreground"
                      }`}
                    >
                      {Icon && <Icon size={15} className="shrink-0" aria-hidden />}
                      {s.label}
                    </button>
                  </li>
                );
              })}
            </ul>
          </nav>

          <div className="min-w-0 flex-1">
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
            {section === "security" && <SecuritySection />}
            {section === "about" && <AboutSection />}
          </div>
        </div>
      </div>
    </div>
  );
}
