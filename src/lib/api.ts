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
  id: string;
  /** 注册表里的展示名（可为中文），与技能自身 name 无关 */
  name: string;
  description: string;
  version: string;
  tags: string[];
  author: string;
  /** 这条来自哪个源（官方 / 自定义源名） */
  registry: string;
  /** 市场目录下是否已安装 */
  installed: boolean;
  /** 已安装版本（空串 = 读不出）；与 version 不同即可提示更新 */
  installed_version: string;
}

/** 市场清单 + 各源失败原因。单个源挂掉不该让整个市场空白。 */
export interface MarketList {
  skills: MarketSkillView[];
  errors: string[];
}

/** 拉取全部源的技能清单（网络请求，失败需重试）。 */
export function listMarketSkills(): Promise<MarketList> {
  return invoke("list_market_skills");
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
