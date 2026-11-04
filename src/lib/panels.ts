/**
 * 右栏面板注册表（v0.8.0）。
 *
 * 此前三个 tab 写死在 App.tsx 的 JSX 里，加一种面板要改外壳。
 * 参照 dsh ui-sidebar-right/tab-registry 的最小形态：id 唯一、按 order 排序、
 * 注册返回卸载器，外壳只消费注册表派生的列表。
 */
export interface PanelDefinition {
  id: string;
  label: string;
  order: number;
}

export class PanelRegistry {
  private readonly panels = new Map<string, PanelDefinition>();

  register(def: PanelDefinition): () => void {
    if (this.panels.has(def.id)) {
      throw new Error(`面板 ${def.id} 已注册`);
    }
    this.panels.set(def.id, def);
    return () => {
      this.panels.delete(def.id);
    };
  }

  has(id: string): boolean {
    return this.panels.has(id);
  }

  list(): PanelDefinition[] {
    return [...this.panels.values()].sort((a, b) => a.order - b.order);
  }
}

export const panelRegistry = new PanelRegistry();
