/**
 * 右栏标签页的数据模型（v0.8.0）。
 *
 * 此前右栏是「网页 / 文件」这类**固定分区**：分区写死在 JSX 里，
 * 加一种要改外壳，且同一种类只能开一个。现在改成统一标签页——
 * 每种类型是一个「标签种类」，标签页是它的**实例**。
 *
 * 两条设计约定：
 *
 * 1. **标签 id 与内容身份分离**。`id` 只是本窗口内的句柄（`tab1`、`tab2`…），
 *    `contentId` 才是内容的身份（终端=终端 id，网页=url）。
 *    持久化只认 `contentId`：标签 id 每次会话都会重新分配，
 *    拿它当存储键，重启后必然张冠李戴。
 * 2. **纯函数优先**。打开/关闭/激活都是纯函数，不碰 DOM、不读全局状态，
 *    便于单测钉住「关掉当前标签后该激活谁」这类边界。
 */

/** 标签种类。`start` 是侧栏开始页，其余对应右栏原有面板。 */
export type SidebarTabKind =
  | "start"
  | "files"
  | "web"
  | "terminal"
  | "todo"
  | "usage";

/** 一个标签页实例。 */
export interface SidebarTab {
  /** 窗口内唯一的标签句柄 */
  id: string;
  kind: SidebarTabKind;
  /** 内容身份：同种类内区分不同实例 */
  contentId: string;
  /** 标签上显示的标题 */
  title: string;
  /** 打开时带的参数（终端的 shell、网页的初始地址等） */
  params?: Record<string, string>;
}

/** 标签页集合的完整状态。 */
export interface SidebarTabsState {
  tabs: SidebarTab[];
  /** 当前激活的标签 id */
  activeId: string;
  /** 下一个标签 id 的序号，单调递增 */
  seq: number;
}

/** 开始页的内容身份是固定的。 */
export const START_CONTENT_ID = "sidebar://start";

/** 终端标签的内容身份前缀：后接终端 id。 */
export const TERMINAL_CONTENT_PREFIX = "terminal:";

/** 生成终端标签的内容身份。 */
export function terminalContentId(terminalId: string): string {
  return `${TERMINAL_CONTENT_PREFIX}${terminalId}`;
}

/** 空状态：没有任何标签。 */
export function emptyTabsState(): SidebarTabsState {
  return { tabs: [], activeId: "", seq: 1 };
}

/**
 * 打开一个标签。
 *
 * 同种类且同内容身份时**不重复开**，只把已存在的那个激活——
 * 连点两次「新建终端」应当是两个终端（内容身份不同），
 * 但反复点同一个入口不该堆出一排一样的标签。
 */
export function openTab(
  state: SidebarTabsState,
  kind: SidebarTabKind,
  contentId: string,
  title: string,
  params?: Record<string, string>,
): SidebarTabsState {
  const existing = state.tabs.find(
    (tab) => tab.kind === kind && tab.contentId === contentId,
  );
  if (existing) {
    return state.activeId === existing.id
      ? state
      : { ...state, activeId: existing.id };
  }
  const tab: SidebarTab = {
    id: `tab${state.seq}`,
    kind,
    contentId,
    title,
    ...(params ? { params } : {}),
  };
  return {
    tabs: [...state.tabs, tab],
    activeId: tab.id,
    seq: state.seq + 1,
  };
}

/** 激活某个标签。标签不存在时原样返回。 */
export function activateTab(
  state: SidebarTabsState,
  tabId: string,
): SidebarTabsState {
  if (!state.tabs.some((tab) => tab.id === tabId)) return state;
  return state.activeId === tabId ? state : { ...state, activeId: tabId };
}

/**
 * 标签能否关闭。
 *
 * 至少要留一个标签——关掉最后一个会让右栏变成空白，用户无处可去。
 */
export function canCloseTab(state: SidebarTabsState, tabId: string): boolean {
  if (state.tabs.length <= 1) return false;
  return state.tabs.some((tab) => tab.id === tabId);
}

/**
 * 关闭某个标签。
 *
 * 关掉的是当前标签时，激活**右边**的那个；它是最后一个时激活左边的。
 * 这与浏览器的行为一致：标签栏从左往右排，关掉一个后视线落在相邻标签上。
 */
export function closeTab(
  state: SidebarTabsState,
  tabId: string,
): SidebarTabsState {
  if (!canCloseTab(state, tabId)) return state;
  const index = state.tabs.findIndex((tab) => tab.id === tabId);
  if (index < 0) return state;
  const tabs = state.tabs.filter((tab) => tab.id !== tabId);
  let activeId = state.activeId;
  if (activeId === tabId) {
    const next = tabs[index] ?? tabs[tabs.length - 1];
    activeId = next ? next.id : "";
  }
  return { ...state, tabs, activeId };
}

/** 取当前激活的标签。 */
export function activeTab(state: SidebarTabsState): SidebarTab | undefined {
  return state.tabs.find((tab) => tab.id === state.activeId);
}

/** 按内容身份找标签。 */
export function findByContent(
  state: SidebarTabsState,
  kind: SidebarTabKind,
  contentId: string,
): SidebarTab | undefined {
  return state.tabs.find(
    (tab) => tab.kind === kind && tab.contentId === contentId,
  );
}

const STORAGE_KEY = "aura.sidebar.tabs.v1";

const KINDS: readonly SidebarTabKind[] = [
  "start",
  "files",
  "web",
  "terminal",
  "todo",
  "usage",
];

function isKind(value: unknown): value is SidebarTabKind {
  return typeof value === "string" && (KINDS as readonly string[]).includes(value);
}

/**
 * 校验并修复从存储里读出来的状态。
 *
 * 存储是用户可改的，也可能来自旧版本：字段缺失、种类不认识、
 * activeId 指向已删除的标签都要能兜住，而不是让右栏整个崩掉。
 * 读不出来就当没有存档。
 */
export function sanitizeTabsState(raw: unknown): SidebarTabsState | null {
  if (typeof raw !== "object" || raw === null) return null;
  const obj = raw as Record<string, unknown>;
  if (!Array.isArray(obj.tabs)) return null;

  const tabs: SidebarTab[] = [];
  for (const item of obj.tabs) {
    if (typeof item !== "object" || item === null) continue;
    const tab = item as Record<string, unknown>;
    if (typeof tab.id !== "string" || typeof tab.contentId !== "string") continue;
    if (!isKind(tab.kind)) continue;
    // 终端进程活不过一次重启，存档里的终端标签一律丢弃，
    // 否则会点开一个指向已死进程的空终端。
    if (tab.kind === "terminal") continue;
    tabs.push({
      id: tab.id,
      kind: tab.kind,
      contentId: tab.contentId,
      title: typeof tab.title === "string" ? tab.title : "",
      ...(tab.params && typeof tab.params === "object"
        ? { params: tab.params as Record<string, string> }
        : {}),
    });
  }
  if (tabs.length === 0) return null;

  // id 必须唯一，否则 React 的 key 会撞。
  const seen = new Set<string>();
  const unique = tabs.filter((tab) => {
    if (seen.has(tab.id)) return false;
    seen.add(tab.id);
    return true;
  });

  const activeId =
    typeof obj.activeId === "string" &&
    unique.some((tab) => tab.id === obj.activeId)
      ? obj.activeId
      : unique[0].id;

  const maxSeq = unique.reduce((max, tab) => {
    const n = Number.parseInt(tab.id.replace(/^tab/, ""), 10);
    return Number.isFinite(n) && n > max ? n : max;
  }, 0);
  const seq =
    typeof obj.seq === "number" && Number.isFinite(obj.seq)
      ? Math.max(obj.seq, maxSeq + 1)
      : maxSeq + 1;

  return { tabs: unique, activeId, seq };
}

/** 读存档。读不出来（无存档/格式损坏）返回 null。 */
export function loadTabsState(): SidebarTabsState | null {
  if (typeof localStorage === "undefined") return null;
  let raw: string | null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
  if (raw === null) return null;
  try {
    return sanitizeTabsState(JSON.parse(raw));
  } catch {
    // 存档损坏就当没有，别让右栏开不起来
    return null;
  }
}

/** 写存档。失败（隐私模式、配额满）不该影响使用，静默忽略。 */
export function saveTabsState(state: SidebarTabsState): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // 存不下就下次再存
  }
}
