import { invoke } from "@tauri-apps/api/core";
import type { ChatMessage } from "../store";
import type { Todo } from "./todo";

export interface SavedSession {
  id: string;
  title: string;
  workspace: string;
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

export function sendMessage(
  sessionId: string,
  message: string,
  mode: string,
): Promise<void> {
  return invoke("send_message", { sessionId, message, mode });
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

export function getSelectedModel(): Promise<string> {
  return invoke("get_selected_model");
}

export function setSelectedModel(id: string): Promise<void> {
  return invoke("set_selected_model", { id });
}

export interface ApiConfig {
  provider: string;
  api_key: string;
}

export function getApiConfig(): Promise<ApiConfig> {
  return invoke("get_api_config");
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
