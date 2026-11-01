import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { ArrowLeft } from "lucide-react";
import type { Theme } from "../hooks/useTheme";
import { getGlobalRules } from "../lib/api";
import AboutSection from "./AboutSection";
import AppearanceSection from "../components/AppearanceSection";
import GeneralSection from "../components/GeneralSection";
import ModelSection from "../components/ModelSection";

interface Props {
  onClose: () => void;
  theme: Theme;
  setTheme: (theme: Theme) => void;
}

const SECTIONS = [
  { id: "appearance", label: "外观" },
  { id: "model", label: "模型服务" },
  { id: "general", label: "通用" },
  { id: "about", label: "关于" },
] as const;

type SectionId = (typeof SECTIONS)[number]["id"];

export default function SettingsPage({ onClose, theme, setTheme }: Props) {
  const [section, setSection] = useState<SectionId>("appearance");
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
          <nav className="w-36 shrink-0">
            <ul className="space-y-0.5">
              {SECTIONS.map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => setSection(s.id)}
                    aria-current={section === s.id ? "page" : undefined}
                    className={`w-full rounded-tag px-3 py-1.5 text-left text-sm transition-colors ${
                      section === s.id
                        ? "bg-bubble font-medium text-foreground"
                        : "text-subtle hover:bg-bubble hover:text-foreground"
                    }`}
                  >
                    {s.label}
                  </button>
                </li>
              ))}
            </ul>
          </nav>

          <div className="min-w-0 flex-1">
            {section === "appearance" && (
              <AppearanceSection theme={theme} setTheme={setTheme} />
            )}
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
    </div>
  );
}
