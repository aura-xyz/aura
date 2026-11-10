/**
 * 设置分区注册表（v0.8.0，参照 dsh ui-settings-general 的 slot 形态）。
 *
 * 此前四个分区写死在 SettingsPage 的常量里，加一个分区要改外壳。
 * 现在分区是注册项，外壳只消费列表；渲染体仍由页面按 id 分派。
 */
export interface SettingsSectionDefinition {
  id: string;
  label: string;
  order: number;
}

const registry = new Map<string, SettingsSectionDefinition>();

const DEFAULTS: SettingsSectionDefinition[] = [
  { id: "appearance", label: "外观", order: 10 },
  { id: "model", label: "模型服务", order: 20 },
  { id: "shortcuts", label: "快捷键", order: 28 },
  { id: "general", label: "通用", order: 30 },
  { id: "security", label: "安全", order: 35 },
  { id: "about", label: "关于", order: 40 },
];

for (const def of DEFAULTS) {
  if (!registry.has(def.id)) registry.set(def.id, def);
}

/** 注册一个分区，返回卸载器；同 id 重复注册直接报错。 */
export function registerSettingsSection(def: SettingsSectionDefinition): () => void {
  if (registry.has(def.id)) throw new Error(`设置分区 ${def.id} 已注册`);
  registry.set(def.id, def);
  return () => {
    registry.delete(def.id);
  };
}

export function settingsSections(): SettingsSectionDefinition[] {
  return [...registry.values()].sort((a, b) => a.order - b.order);
}
