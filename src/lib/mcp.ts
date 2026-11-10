/**
 * MCP 服务器前端契约（v0.8.0 rc.3 C65）。
 *
 * 与后端 `commands.rs` 的返回结构逐字段对齐（返回结构为 snake_case）。
 * 命令参数名与后端函数形参同名（均为单词，无驼峰歧义）。
 */
import { invoke } from "@tauri-apps/api/core";

export type McpStatus = "running" | "connecting" | "down" | "disabled";

/** 单台服务器卡片视图。 */
export interface McpServerView {
  id: number;
  name: string;
  command: string;
  args: string[];
  enabled: boolean;
  status: McpStatus;
  status_reason: string | null;
  tool_count: number;
  workspaces: string[];
}

/** 单个工具（详情展示：原始名与对外改写名对照）。 */
export interface McpToolItem {
  name: string;
  external_name: string;
  description: string;
  schema: string | null;
}

/** 握手协商出的服务器能力（v0.8.1 M2-02）。 */
export interface McpCapabilities {
  protocol_version: string;
  server_name: string;
  server_version: string;
  tools: boolean;
  tools_list_changed: boolean;
  resources: boolean;
  resources_subscribe: boolean;
  prompts: boolean;
  prompts_list_changed: boolean;
}

/** 单服务器状态详情。 */
export interface McpStatusView {
  status: McpStatus;
  reason: string | null;
  stderr: string[];
  tool_count: number;
  tools: McpToolItem[];
  capabilities: McpCapabilities;
}

/** 把能力快照压成设置页要显示的域徽标；未声明的域也列出并置灰。 */
export function capabilityDomains(c: McpCapabilities | null | undefined): {
  label: string;
  on: boolean;
}[] {
  return [
    { label: "tools", on: !!c?.tools },
    { label: "resources", on: !!c?.resources },
    { label: "prompts", on: !!c?.prompts },
  ];
}

/** resources 域的一条资源 / URI 模板（v0.8.1 M2-04）。 */
export interface McpResourceView {
  uri: string;
  name: string;
  description: string;
  mime_type: string | null;
  /** URI 模板需要参数展开，二期不提供读取 */
  template: boolean;
}

/** resources/read 的结果。blob 只统计字节，不解码进 text。 */
export interface McpResourceReadView {
  uri: string;
  text: string;
  mime_type: string | null;
  truncated: boolean;
  total_bytes: number;
  blob_bytes: number;
}

/** 资源条目的显示名：服务器常不给 name，退回 URI 尾段。 */
export function resourceLabel(r: McpResourceView): string {
  if (r.name.trim()) return r.name;
  const parts = r.uri.split("/").filter(Boolean);
  return parts[parts.length - 1] || r.uri;
}

/** 添加前试连结果。 */
export interface McpTestResult {
  ok: boolean;
  tool_count: number;
  error: string | null;
  stderr: string[];
}

/** 新增 / 编辑表单的输入。 */
export interface McpServerInput {
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  workspaces: string[];
}

/** 状态 → 展示元信息。 */
export const MCP_STATUS_META: Record<
  McpStatus,
  { label: string; dot: string; text: string }
> = {
  running: { label: "已连接", dot: "bg-success", text: "text-success" },
  connecting: { label: "连接中", dot: "bg-warning", text: "text-warning" },
  down: { label: "未连接", dot: "bg-danger", text: "text-danger" },
  disabled: { label: "已停用", dot: "bg-line", text: "text-subtle" },
};

/** 命令 + 参数的一行摘要。 */
export function commandSummary(
  s: Pick<McpServerView, "command" | "args">,
): string {
  return [s.command, ...s.args].join(" ").trim();
}

/** 解析「每行一个 KEY=VALUE」的环境变量文本；忽略空行与 # 注释。 */
export function parseEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (key) out[key] = value;
  }
  return out;
}

/** 环境变量对象 → 表单文本（每行 KEY=VALUE）。 */
export function envToText(env: Record<string, string>): string {
  return Object.entries(env)
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
}

/** 文本 → 非空行数组（参数 / 工作区共用）。 */
export function toLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// ── 命令封装 ─────────────────────────────────────────────────

export function listServers(): Promise<McpServerView[]> {
  return invoke("mcp_list_servers");
}

export function addServer(input: McpServerInput): Promise<McpServerView> {
  return invoke("mcp_add_server", { ...input });
}

export function updateServer(
  id: number,
  input: McpServerInput,
): Promise<McpServerView> {
  return invoke("mcp_update_server", { id, ...input });
}

export function removeServer(id: number): Promise<void> {
  return invoke("mcp_remove_server", { id });
}

export function setServerEnabled(
  id: number,
  enabled: boolean,
): Promise<McpServerView> {
  return invoke("mcp_set_server_enabled", { id, enabled });
}

export function getServerStatus(id: number): Promise<McpStatusView> {
  return invoke("mcp_server_status", { id });
}

export function rescanTools(id: number): Promise<McpServerView> {
  return invoke("mcp_rescan_tools", { id });
}

export function testConnect(
  input: Pick<McpServerInput, "name" | "command" | "args" | "env">,
): Promise<McpTestResult> {
  return invoke("mcp_test_connect", { ...input });
}

// ── resources 域（v0.8.1 M2-04）────────────────────────────

/** 每次调用都会让后端重扫一次，等价于「刷新」。 */
export function listResources(id: number): Promise<McpResourceView[]> {
  return invoke("mcp_list_resources", { id });
}

export function readResource(
  id: number,
  uri: string,
): Promise<McpResourceReadView> {
  return invoke("mcp_read_resource", { id, uri });
}
