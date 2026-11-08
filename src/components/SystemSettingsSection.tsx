/**
 * 系统集成设置：运行时防止系统休眠、开机自动启动（v0.8.0）。
 *
 * 两个开关都以后端回读的**系统真实状态**为准，不乐观更新本地值 ——
 * 注册表/桌面文件写入失败时，界面不能显示成「已开启」。
 */
import { useEffect, useState } from "react";
import {
  getSystemSettings,
  setSystemSettings,
  type SystemSettings,
} from "../lib/api";
import Switch from "./Switch";

type Field = "prevent_sleep" | "autostart";

export default function SystemSettingsSection() {
  const [settings, setSettings] = useState<SystemSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    getSystemSettings()
      .then((s) => {
        if (!cancelled) setSettings(s);
      })
      .catch((e) => {
        if (!cancelled) {
          setError(typeof e === "string" ? e : "读取系统设置失败");
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function toggle(field: Field) {
    if (!settings || busy) return;
    const next: SystemSettings = { ...settings, [field]: !settings[field] };
    setBusy(true);
    setError("");
    try {
      setSettings(await setSystemSettings(next.prevent_sleep, next.autostart));
    } catch (e) {
      setError(typeof e === "string" ? e : "保存失败，请重试");
    } finally {
      setBusy(false);
    }
  }

  const ready = settings !== null && !busy;

  return (
    <div className="border-b border-line pb-5">
      <h3 className="text-sm font-medium">系统集成</h3>

      <div className="mt-4 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <span className="text-sm">运行时防止系统休眠</span>
          <p className="mt-1 text-xs leading-relaxed text-subtle">
            长任务执行期间保持系统唤醒，合上盖子仍会休眠。
            {settings && !settings.prevent_sleep_supported && (
              <span className="ml-1">当前平台暂不支持。</span>
            )}
          </p>
        </div>
        <Switch
          label="运行时防止系统休眠"
          checked={settings?.prevent_sleep ?? false}
          disabled={!ready || !settings?.prevent_sleep_supported}
          onChange={() => void toggle("prevent_sleep")}
        />
      </div>

      <div className="mt-4 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <span className="text-sm">开机自动启动</span>
          <p className="mt-1 text-xs leading-relaxed text-subtle">
            登录系统后在后台启动 Aura（写入当前用户启动项，无需管理员权限）。
          </p>
        </div>
        <Switch
          label="开机自动启动"
          checked={settings?.autostart ?? false}
          disabled={!ready}
          onChange={() => void toggle("autostart")}
        />
      </div>

      {error && (
        <p role="alert" className="mt-3 text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
