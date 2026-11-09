import { invoke } from "@tauri-apps/api/core";
import type { ChatMessage } from "../store";
import type { Todo } from "./todo";

export interface SavedSession {
  id: string;
  title: string;
  workspace: string;
  /** 最近更新时间（Unix 秒）。C51 起后端返回，旧库为 0 */
  updated_at: number;
  messages: ChatMessage[];
  /** 任务清单。旧版本会话可能没有该字段，按空处理 */
  todos?: Todo[];
}

export interface ModelInfo {
  id: string;
  /** `{provider}:{id}` 复合 key（选中/切换主键） */
  key: string;
  provider: string;
  /** 供应商展示名（用户自定义名优先），用于分组标题 */
  provider_name: string;
  label: string;
  context_limit: number;
  /** 是否已收藏；未收藏仅在设置页可选目录中出现 */
  pinned: boolean;
}

/**
 * 一条图片附件（v0.8.0，C55 图片粘贴 / 拖放）。
 *
 * - `path`：本地文件绝对路径（拖放 / 文件选择器所得），预览走 asset protocol（C54 通道）。
 * - `url`：剪贴板粘贴的图片没有真实路径，用 blob: 对象 URL 做缩略图与预览。
 * 二者至多其一存在。`name` 始终有值，用于 chip 与消息流展示。
 * 后端多模态尚未就绪时，发送端降级为只携带 path 引用；后端就绪后此处无需改动，
 * 只需在 `send_message` 命令里消费 `images` 即可无缝切换。
 */
export interface ImageRef {
  name: string;
  path?: string;
  url?: string;
}

export function sendMessage(
  sessionId: string,
  message: string,
  mode: string,
  images?: ImageRef[],
): Promise<void> {
  return invoke("send_message", { sessionId, message, mode, images });
}

/**
 * 中断当前正在执行的流。
 *
 * 必须带 `sessionId`：后端会校验归属，传别的会话会被忽略——
 * 否则切到别的会话点「停止」会把这边正在跑的任务停掉。
 */
export function stopMessage(sessionId: string): Promise<void> {
  return invoke("stop_message", { sessionId });
}

export function removeSession(sessionId: string): Promise<void> {
  return invoke("remove_session", { sessionId });
}

export function loadSessions(): Promise<SavedSession[]> {
  return invoke("load_sessions");
}

export function saveSession(
  id: string,
  title: string,
  workspace: string,
  messages: ChatMessage[],
): Promise<void> {
  return invoke("save_session", { id, title, workspace, messages });
}

/**
 * 覆盖保存任务清单，返回后端清洗过的结果。
 * 后端会按与模型产出相同的规则去空标题、去重复 id。
 */
export function saveTodos(sessionId: string, todos: Todo[]): Promise<Todo[]> {
  return invoke("save_todos", { sessionId, todos });
}

export function setWorkspace(path: string): Promise<string> {
  return invoke("set_workspace", { path });
}

export function getWorkspace(): Promise<string> {
  return invoke("get_workspace");
}

export function getGlobalRules(): Promise<string> {
  return invoke("get_global_rules");
}

export function setGlobalRules(rules: string): Promise<void> {
  return invoke("set_global_rules", { rules });
}

export function getModels(): Promise<ModelInfo[]> {
  return invoke("get_models");
}

/** 设置某供应商的模型收藏（传入完整已收藏 key 列表，幂等覆盖）。 */
export function setPinnedModels(
  provider: string,
  keys: string[],
): Promise<number> {
  return invoke("set_pinned_models", { provider, keys });
}

/**
 * 保存模型目录：把设置页已拉到的远端列表合并进配置并写入收藏。
 *
 * 不能只调 setPinnedModels —— 后端只给已有条目打标记，目录里新勾选的
 * 模型必须先合并。旧链路用 refresh_provider_models 做合并，但它会重新
 * 联网且依赖已启用的执行器，供应商未就绪就整条失败（实测「收藏不了」）。
 */
export function saveProviderCatalog(
  provider: string,
  remote: RemoteModel[],
  keys: string[],
): Promise<number> {
  return invoke("save_provider_catalog", { provider, remote, keys });
}

export function getSelectedModel(): Promise<string> {
  return invoke("get_selected_model");
}

export function setSelectedModel(id: string): Promise<void> {
  return invoke("set_selected_model", { id });
}

export interface ApiConfig {
  provider: string;
  /** 掩码后的 Key（`sk-***8f2a`），不是真 Key */
  api_key: string;
  /** 是否已配置 Key */
  has_key: boolean;
}

export function getApiConfig(): Promise<ApiConfig> {
  return invoke("get_api_config");
}

/** 清除某个供应商的 API Key（v0.8.1 C46）。 */
export function clearProviderKey(provider: string): Promise<void> {
  return invoke("clear_provider_key", { provider });
}

/** 密钥存储后端状态（v0.8.1 C45/C47）。 */
export interface KeyStoreStatus {
  /** 后端名：Windows DPAPI / 系统密钥环（SecretService）/ 应用内文件加密 */
  name: string;
  /** 强度说明 */
  strength: string;
  /** 是否可用 */
  available: boolean;
  /** 是否为降级档（弱于系统密钥环） */
  degraded: boolean;
}

export function getKeystoreStatus(): Promise<KeyStoreStatus> {
  return invoke("get_keystore_status");
}

export function setApiConfig(provider: string, apiKey: string): Promise<void> {
  return invoke("set_api_config", { provider, apiKey });
}

export function removeWorkspace(path: string, sessionIds: string[]): Promise<void> {
  return invoke("remove_workspace", { path, sessionIds });
}

export type ProviderKind =
  | "openrouter"
  | "openai"
  | "azure"
  | "ollama"
  | "llama_cpp"
  | "custom";

export interface ProviderConfig {
  id: string;
  /** 厂商预设 id（后端可空，仅用于设置页回显厂商） */
  preset?: string | null;
  kind: ProviderKind;
  name: string;
  base_url: string;
  api_key: string;
  headers: Record<string, unknown>;
  /** 模型列表端点路径覆盖（DeepSeek / 阿里百炼等） */
  models_path?: string | null;
  deployment: string | null;
  api_version: string | null;
  enabled: boolean;
}

export function getProviders(): Promise<ProviderConfig[]> {
  return invoke("get_providers");
}

export function setProviders(providers: ProviderConfig[]): Promise<void> {
  return invoke("set_providers", { providers });
}

export interface ProviderStatus {
  id: string;
  ok: boolean;
  latency_ms: number;
  message: string;
}

export function getProviderStatuses(): Promise<ProviderStatus[]> {
  return invoke("get_provider_statuses");
}

/** 拉取供应商远端模型并合并进配置，返回新增模型数。 */
export function refreshProviderModels(provider: string): Promise<number> {
  return invoke("refresh_provider_models", { provider });
}

/** 从厂商远端拉取到的模型描述 */
export interface RemoteModel {
  id: string;
  label: string;
  context_limit: number;
}

/**
 * 按草稿配置拉取厂商远端模型列表（只读，不写入任何持久化状态）。
 * 用户切换厂商后无需先点「保存」即可预览该厂商可用模型。
 */
export function fetchRemoteModels(
  draft: ProviderConfig,
): Promise<RemoteModel[]> {
  return invoke("fetch_remote_models", { draft });
}

/** Ollama 模型拉取（进度经 `ollama_pull` 事件推送），返回新增模型数。 */
export function pullOllamaModel(provider: string, model: string): Promise<number> {
  return invoke("pull_ollama_model", { provider, model });
}

export interface SkillView {
  name: string;
  description: string;
  version: string;
  source: "builtin" | "market" | "local" | "workspace";
  /** 激活期间可用工具白名单；空 = 不收窄（继承模式权限） */
  allowed_tools: string[];
  enabled: boolean;
  /** 技能目录与 SKILL.md 绝对路径 */
  dir: string;
  path: string;
}

/** 列出全部技能（磁盘扫描 + 库里的启用覆盖）。 */
export function listSkills(): Promise<SkillView[]> {
  return invoke("list_skills");
}

/** 一个候选路径（`@` 引用面板用）。文件与目录都在内。 */
export interface FileCandidate {
  /** 插入输入框的路径。**目录以 `/` 结尾** */
  path: string;
  /** 文件名（目录则是目录名） */
  name: string;
  /** 所在目录 */
  dir: string;
  /** 是目录吗 */
  is_dir: boolean;
}

/**
 * 列出工作区里匹配的文件（`@` 引用面板用）。
 *
 * 搜的是**会话自己的工作区**加用户授权的目录——授权目录里的文件
 * 模型也能读，所以也该能被引用。
 */
export function listWorkspaceFiles(
  sessionId: string,
  query: string,
  limit?: number,
): Promise<FileCandidate[]> {
  return invoke("list_workspace_files", { sessionId, query, limit });
}

/** 右侧文件浏览面板的一条目录项（v0.8.0）。 */
export interface DirEntry {
  /** 文件名（展示用） */
  name: string;
  /**
   * 工作区相对路径（前导 `/`）；工作区外的白名单目录为盘符绝对路径。
   * 可直接作为下一次 listDirectory / readFileText 的 path。
   * 后端不会回传带 `\\?\` 扩展前缀的磁盘路径。
   */
  path: string;
  is_dir: boolean;
  /** 文件大小（字节，目录为 0） */
  size: number;
  /** 修改时间（Unix 毫秒，0 表示读不到） */
  modified_ms: number;
  /**
   * 绝对路径（不含 `\\?\` 前缀，正斜杠）。
   * 图片预览走 asset protocol 时前端据此拼 `asset://localhost/<此路径>`；
   * 旧后端可能不含此字段，调用方需做空值兜底。
   */
  absolute_path?: string;
}

/**
 * 列出某个目录下的条目（右侧文件浏览面板用）。
 *
 * 路径语义与工具一致：相对路径按会话工作区解析，前导 `/` 是工作区根，
 * `C:/...` 是盘符绝对路径。访问范围受工作区 + 白名单约束。
 */
export function listDirectory(
  sessionId: string,
  path: string,
): Promise<DirEntry[]> {
  return invoke("list_directory", { sessionId, path });
}

/**
 * 读取文本文件内容（右侧文件浏览面板预览用）。
 *
 * 上限 256KB，超限或非 UTF-8 会返回可读错误（可能是二进制文件）。
 */
export function readFileText(
  sessionId: string,
  path: string,
): Promise<string> {
  return invoke("read_file_text", { sessionId, path });
}

/** 本机可用于「在…中打开」的应用；资源管理器始终在首位。 */
export interface OpenApp {
  id: string;
  name: string;
}

/** 探测已安装的应用（文件资源管理器 / VS Code / JetBrains IDE）。 */
export function listOpenApps(): Promise<OpenApp[]> {
  return invoke("list_open_apps");
}

/** 在指定应用里打开当前会话的工作区；目录由后端从会话取，不由前端传。 */
export function openInApp(appId: string, sessionId: string): Promise<void> {
  return invoke("open_in_app", { appId, sessionId });
}

/** 系统集成设置：运行时防休眠、开机自启。 */
export interface SystemSettings {
  prevent_sleep: boolean;
  autostart: boolean;
  /** 当前平台是否支持防休眠（Linux 无进程级电源抑制原语） */
  prevent_sleep_supported: boolean;
}

export function getSystemSettings(): Promise<SystemSettings> {
  return invoke("get_system_settings");
}

/** 返回系统**实际**状态，前端应直接用它覆盖显示，避免「显示已开、其实没生效」。 */
export function setSystemSettings(
  preventSleep: boolean,
  autostart: boolean,
): Promise<SystemSettings> {
  // Tauri v2 命令参数按 camelCase 匹配（与全库其它 invoke 一致，如 sessionId）。
  // 曾误用 snake_case（prevent_sleep），Tauri 找不到 preventSleep 会直接报
  // 「missing required key preventSleep」——切换开关时必现。
  return invoke("set_system_settings", {
    preventSleep,
    autostart,
  });
}

/** `/goal` 长期目标：按会话存 settings 表，每轮注入 system prompt。 */
export function getSessionGoal(sessionId: string): Promise<string> {
  return invoke("get_session_goal", { sessionId });
}

export function setSessionGoal(sessionId: string, text: string): Promise<void> {
  return invoke("set_session_goal", { sessionId, text });
}

export interface ExportBundle {
  conversation_md: string;
  timeline_md: string;
  updater_log: string;
}

/** `/export`：后端整理会话/时间线/更新日志的可读文本，前端打包成 zip。 */
export function exportSessionBundle(
  sessionId: string,
  title?: string,
): Promise<ExportBundle> {
  return invoke("export_session_bundle", { sessionId, title: title ?? null });
}

export function writeExportBundle(path: string, bytes: number[]): Promise<void> {
  return invoke("write_export_bundle", { path, bytes });
}

/** 启用/禁用技能。禁用后不进 L1 索引，模型看不到也就不会调用。 */
export function setSkillEnabled(name: string, enabled: boolean): Promise<void> {
  return invoke("set_skill_enabled", { name, enabled });
}

/** 删除技能（连目录一起删）。内置与工作区技能会被后端拒绝。 */
export function deleteSkill(name: string): Promise<void> {
  return invoke("delete_skill", { name });
}

export interface MarketSkillView {
  /** 远端 id（provider 内唯一，用于回查安装） */
  id: string;
  /** 本地安装目录名 */
  slug: string;
  /** 注册表里的展示名（可为中文），与技能自身 name 无关 */
  name: string;
  description: string;
  version: string;
  tags: string[];
  author: string;
  /** 这条来自哪个源（官方 / 自定义源名 / SkillHub） */
  registry: string;
  /** 源标识（用于「只看某个源」的筛选） */
  provider_id: string;
  /** 上游是否提供完整性校验。false 时界面必须明确告知 */
  integrity_verified: boolean;
  /** 市场目录下是否已安装 */
  installed: boolean;
  /** 已安装版本（空串 = 读不出）；与 version 不同即可提示更新 */
  installed_version: string;
}

/** 市场清单 + 各源失败原因。单个源挂掉不该让整个市场空白。 */
export interface MarketList {
  skills: MarketSkillView[];
  errors: string[];
  /** 总条数（源支持分页时有效，否则为 0） */
  total: number;
  /** 总页数（源支持分页时有效，否则为 0） */
  total_pages: number;
  /** 该源是否分页 */
  paged: boolean;
}

/**
 * 拉取技能清单。
 *
 * `providerId` 指定则只拉那个源（SkillHub 有 8 万条，必须按源拉）；
 * 不指定则聚合全部源。`query` 只对支持搜索的源生效。
 */
export function listMarketSkills(
  providerId?: string,
  query?: string,
  page?: number,
): Promise<MarketList> {
  return invoke("list_market_skills", {
    providerId: providerId ?? null,
    query: query ?? null,
    page: page ?? null,
  });
}

/** 一个技能源（Provider）。 */
export interface MarketProviderView {
  /** 源标识 */
  id: string;
  /** 展示名 */
  label: string;
  /** 类别：官方 / GitHub / 第三方 */
  kind: string;
  /** 是否可删除 */
  removable: boolean;
}

/** 列出全部可用的技能源。 */
export function listMarketProviders(): Promise<MarketProviderView[]> {
  return invoke("list_market_providers");
}

export type FindingSeverity = "high" | "medium" | "info";

export interface AuditFinding {
  severity: FindingSeverity;
  /** 规则 id，稳定标识 */
  rule: string;
  /** 相对技能根的路径 */
  file: string;
  /** 行号，0 = 文件级问题 */
  line: number;
  note: string;
  excerpt: string;
}

export interface SkillAudit {
  findings: AuditFinding[];
  file_count: number;
  total_bytes: number;
  /** 是否含可执行脚本 */
  has_scripts: boolean;
  scanned_files: number;
}

/** 安装前审查报告（下载 + 校验 + 解包 + 扫描，不写入磁盘）。 */
export interface SkillInspection {
  id: string;
  name: string;
  description: string;
  version: string;
  registry: string;
  already_installed: boolean;
  installed_version: string;
  /** frontmatter 里的 name，可能与目录 id 不同 */
  skill_name: string;
  /** 技能申请的工具范围；空 = 不收窄 */
  tools: string[];
  /** 声明里 Aura 不认识的工具名。非空 = 这个技能装不了 */
  unknown_tools: string[];
  /** 上游是否提供完整性校验 */
  integrity_verified: boolean;
  /** 完整性说明（未校验时告诉用户为什么） */
  integrity_note: string;
  package_files: string[];
  bytes: number;
  audit: SkillAudit;
}

export interface InstallSummary {
  version: string;
  skill_name: string;
  /** 更新时保留下来的用户文件 */
  kept: string[];
  high: number;
  medium: number;
  has_scripts: boolean;
  file_count: number;
}

/** 一个市场来源。官方源 removable=false，不可删除。 */
export interface SkillSourceView {
  name: string;
  url: string;
  removable: boolean;
  repo: string;
}

export function listSkillSources(): Promise<SkillSourceView[]> {
  return invoke("list_skill_sources");
}

/** 添加自定义源（仅 GitHub 仓库根地址），返回更新后的源列表。 */
export function addSkillSource(url: string): Promise<SkillSourceView[]> {
  return invoke("add_skill_source", { url });
}

export function removeSkillSource(url: string): Promise<SkillSourceView[]> {
  return invoke("remove_skill_source", { url });
}

// ── 操作时间线（v0.6.2）─────────────────────────────────────────

export type TimelineKind =
  | "user"
  | "assistant"
  | "tool"
  | "denied"
  | "context"
  | "todo"
  | "error"
  | "notice";

/** 一条时间线记录。 */
export interface TimelineEntry {
  session_id: string;
  seq: number;
  ts_ms: number;
  /** 第几轮（工具轮次）；0 = 对话开始 */
  turn: number;
  kind: TimelineKind;
  title: string;
  detail: string | null;
  ok: boolean;
  /** 耗时（毫秒），仅工具类有 */
  duration_ms: number | null;
}

/** 读某会话的时间线（对话级隔离：只返回该会话的记录）。 */
export function listTimeline(sessionId: string): Promise<TimelineEntry[]> {
  return invoke("list_timeline", { sessionId });
}

/** 导出某会话的时间线为 Markdown。 */
export function exportTimeline(
  sessionId: string,
  title?: string,
): Promise<string> {
  return invoke("export_timeline", { sessionId, title: title ?? null });
}

// ── 历史截断（v0.7.0）─────────────────────────────────────────────
/** 截断结果。 */
export interface TruncateHistoryResult {
  /** 截断后保留的 history entry 数 */
  keep_entries: number;
  /** 截断后仍然存在的真实用户消息条数 */
  keep_user_messages: number;
  /** 是否因请求条数超过实际数量而被截到末尾 */
  clamped: boolean;
}

/**
 * 把会话的 agent 历史回滚到「保留到第 N 条真实用户消息为止」。
 *
 * 语义（与后端一致）：
 * - `keepThroughUser = k` → 保留第 1..=k 条用户消息，**删掉第 k 条触发的回答**
 *   及其后的一切。用于「重新生成第 k 条回答」。
 * - `keepThroughUser = k - 1` → 连第 k 条用户消息本身也删掉。
 *   用于「编辑第 k 条用户消息并重跑」。
 */
export function truncateHistory(
  sessionId: string,
  keepThroughUser: number,
): Promise<TruncateHistoryResult> {
  return invoke("truncate_history", { sessionId, keepThroughUser });
}

// ── 侧作用检查（v0.7.1）─────────────────────────────────────────────
/** 侧作用检查结果。 */
export interface SideEffectsResult {
  /** 写类工具调用次数（write_file/string_replace/replace_lines） */
  writes: number;
  /** 执行类工具调用次数（run_script） */
  execs: number;
  /** 受影响的目标路径（去重）。run_script 用命令首行。 */
  targets: string[];
}

/**
 * 检查会话历史中即将被截断部分的侧作用（写/执行工具）。
 *
 * 用于「重新生成/编辑重跑」前预检：前端据此决定是否弹确认框。
 * 只读 DB，不修改内存态。
 */
export function inspectSideEffects(
  sessionId: string,
  keepThroughUser: number,
): Promise<SideEffectsResult> {
  return invoke("inspect_side_effects", { sessionId, keepThroughUser });
}

// ── 路径白名单（v0.6.2）─────────────────────────────────────────

/** 一个白名单条目。 */
export interface AllowlistPathView {
  /** 归一化后的绝对路径（正斜杠） */
  path: string;
  /** 展示名 */
  label: string;
  /** 内置默认项（技能目录），不可删除 */
  builtin: boolean;
  /** 目录是否还存在 */
  exists: boolean;
}

/** 路径判定结果。level 决定前端要不要弹确认框。 */
export interface AllowlistCheck {
  /** "allow" | "confirm" | "reject" */
  level: "allow" | "confirm" | "reject";
  /** 面向用户的说明 */
  reason: string;
  /** 归一化后的绝对路径 */
  path: string;
}

export function listAllowlistPaths(): Promise<AllowlistPathView[]> {
  return invoke("list_allowlist_paths");
}

/**
 * 判定路径能否加入白名单。只判定不落库。
 *
 * 后端在真正写入时会**重新判定**——这里的结论只是给界面用的。
 */
export function checkAllowlistPath(path: string): Promise<AllowlistCheck> {
  return invoke("check_allowlist_path", { path });
}

/**
 * 添加白名单路径。
 *
 * `acknowledged` 只表示「用户看到了警告并点了确认」，
 * 不能用来绕过硬拒档——后端会重新判定并拒绝危险路径。
 */
export function addAllowlistPath(
  path: string,
  label: string | undefined,
  acknowledged: boolean,
): Promise<AllowlistPathView[]> {
  return invoke("add_allowlist_path", { path, label, acknowledged });
}

export function removeAllowlistPath(path: string): Promise<AllowlistPathView[]> {
  return invoke("remove_allowlist_path", { path });
}

/**
 * 下载并审查一个市场技能，返回权限与风险清单。不写入任何东西——
 * 用户看过报告后才会真正安装。
 */
export function inspectMarketSkill(id: string): Promise<SkillInspection> {
  return invoke("inspect_market_skill", { id });
}

/**
 * 安装/更新市场技能。后端会以服务端清单为准重新解析地址与哈希，
 * 前端不传 URL——避免「界面传什么就装什么」。
 *
 * `acceptRisky` 只是「用户已看过高危清单」的确认位，不能跳过审查本身。
 */
export function installMarketSkill(
  id: string,
  acceptRisky: boolean,
  update: boolean,
): Promise<InstallSummary> {
  return invoke("install_market_skill", { id, acceptRisky, update });
}

// ── 系统通知（v0.7.0）─────────────────────────────────────────────

/**
 * 发一条系统通知。
 *
 * 只在窗口不在前台时调用——用户正盯着屏幕时弹通知是打扰。
 * 通知失败不视为错误，由后端吞掉。
 */
export function notify(title: string, body: string): Promise<void> {
  return invoke("notify", { title, body });
}

/**
 * 退出应用（v0.7.0）。
 *
 * 关闭窗口是「隐藏到托盘」（常驻后台），所以必须有一条明确的退出路径。
 */
export function quitApp(): Promise<void> {
  return invoke("quit_app");
}

// ── 自动更新（v0.7.0：多源下载）────────────────────────────────────

/** 一个候选下载源。后端会实测各源速度后挑一个。 */
export interface DownloadSource {
  /** 展示名，如「GitHub 直连」「ghfast」 */
  label: string;
  /** 完整 URL */
  url: string;
}

/** 检查更新的结果。`null` 表示已是最新版本。 */
export interface UpdateInfoView {
  version: string;
  notes?: string;
  date?: string;
  /** 候选下载源 */
  sources: DownloadSource[];
}

/**
 * 检查是否有新版本。
 *
 * 后端负责取清单（插件配了三个端点、会自动回退）并把下载句柄存起来，
 * 安装阶段直接复用——不再让前端持有一个会过期的句柄。
 */
export function checkUpdate(): Promise<UpdateInfoView | null> {
  return invoke("check_update");
}

/**
 * 下载并安装更新。
 *
 * 后端会并发探测各下载源、挑最快的那个，再交给 updater 插件做签名校验与安装。
 * 进度通过 `update:progress` 事件推送。
 */
export function downloadUpdate(): Promise<void> {
  return invoke("download_update");
}

// ── 命令审批（v0.8.0 C40/C41）────────────────────────────────

export type ApprovalPolicyId = "strict" | "dangerous" | "auto";

export interface ApprovalPolicyView {
  policy: ApprovalPolicyId;
  /** 中文名，直接显示，避免前端再维护一份文案 */
  label: string;
  /** `session` = 本会话覆盖，`global` = 继承全局默认 */
  scope: "session" | "global";
}

/**
 * 决议一次审批。返回 `false` 表示后端已无此请求（超时或已决议）。
 *
 * `remember` 只在允许时有意义：记住拒绝等于把这条规则永久拉黑，
 * 而用户往往只是这次不想跑。
 */
export function resolveApproval(
  id: string,
  approved: boolean,
  remember = false,
): Promise<boolean> {
  return invoke("resolve_approval", { id, approved, remember });
}

export function getApprovalPolicy(sessionId: string): Promise<ApprovalPolicyView> {
  return invoke("get_approval_policy", { sessionId });
}

/** `sessionId` 省略时写全局默认。 */
export function setApprovalPolicy(
  policy: ApprovalPolicyId,
  sessionId?: string,
): Promise<void> {
  return invoke("set_approval_policy", { policy, sessionId: sessionId ?? null });
}

// ── 安全事件（v0.8.0 C42/C43）────────────────────────────────

export interface SecurityEvent {
  id: number;
  ts_ms: number;
  session_id: string;
  /** blocked_command / path_denied / mode_denied / approval_denied / approval_allowed / risky_install / mcp_call */
  kind: string;
  subject: string;
  reason: string;
  rule_id: string;
}

export function listSecurityEvents(limit = 100): Promise<SecurityEvent[]> {
  return invoke("security_list_events", { limit });
}

/** 导出 CSV，返回写入的事件条数。 */
export function securityExportEvents(path: string): Promise<number> {
  return invoke("security_export_events", { path });
}
