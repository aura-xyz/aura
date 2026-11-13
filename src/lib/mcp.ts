/**
 * MCP 服务器前端契约（v0.8.0 rc.3 C65）。
 *
 * 与后端 `commands.rs` 的返回结构逐字段对齐（返回结构为 snake_case）。
 * 命令参数名与后端函数形参同名（均为单词，无驼峰歧义）。
 */
import { invoke } from "@tauri-apps/api/core";
import { Sparkles } from "lucide-react";
import type { CommandItem } from "./commandItems";

export type McpStatus = "running" | "connecting" | "down" | "disabled";

/** 信任分级与连接策略（v0.8.1 M2-08）。 */
export interface McpServerPolicy {
  /** "strict"（默认）或 "trusted" */
  trust_level: string;
  auto_reconnect: boolean;
  tool_limit: number;
  concurrent: boolean;
}

/** 默认策略刻意保持一期行为：严格审批 / 不自动重连 / 串行 / 50 上限。 */
export function defaultPolicy(): McpServerPolicy {
  return {
    trust_level: "strict",
    auto_reconnect: false,
    tool_limit: 50,
    concurrent: false,
  };
}

export function policyLabel(p: McpServerPolicy | undefined): string {
  return p?.trust_level === "trusted" ? "已信任" : "严格";
}

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
  policy: McpServerPolicy;
}

/** 单个工具（详情展示：原始名与对外改写名对照）。 */
export interface McpToolItem {
  name: string;
  external_name: string;
  description: string;
  schema: string | null;
  /** 服务器自报注解的紧凑 JSON，仅展示、不参与放行判定（M2-07）。 */
  annotations: string | null;
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

/** prompts 域的模板参数（v0.8.1 M2-06）。 */
export interface McpPromptArgView {
  name: string;
  description: string;
  required: boolean;
}

/** 单台服务器的一条提示词。 */
export interface McpPromptView {
  name: string;
  description: string;
  arguments: McpPromptArgView[];
}

/** 跨服务器聚合后的候选项，用于命令面板与设置页。 */
export interface McpPromptItemView extends McpPromptView {
  server_id: number;
  server_name: string;
}

/** prompts/get 的一条消息（不可信文本）。 */
export interface McpPromptMessageView {
  role: string;
  text: string;
}

/** 填入输入框的纯文本，与后端 prompt_plain_text 同口径。 */
export function promptPlainText(messages: McpPromptMessageView[]): string {
  if (messages.length === 1) return messages[0].text;
  return messages.map((m) => `[${m.role}] ${m.text}`).join("\n\n");
}

/** 命令面板里 MCP 提示词的稳定 id，带服务器 id 避免跨服重名。 */
export function mcpPromptCommandId(p: McpPromptItemView): string {
  return `mcp-prompt:${p.server_id}:${p.name}`;
}

/** 把聚合后的提示词转成 `/` 命令面板候选项。 */
export function mcpPromptCommandItems(
  items: McpPromptItemView[],
  query: string,
): CommandItem[] {
  const q = query.trim().toLowerCase();
  return items
    .filter((p) => {
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        p.server_name.toLowerCase().includes(q) ||
        p.description.toLowerCase().includes(q)
      );
    })
    .map((p) => ({
      id: mcpPromptCommandId(p),
      label: `mcp:${p.server_name}/${p.name}`,
      detail:
        p.description ||
        (p.arguments.length
          ? `参数：${p.arguments.map((a) => a.name).join(", ")}`
          : "MCP 提示词"),
      icon: Sparkles,
      group: "skill" as const,
    }));
}

/** 拉取所有已启用服务器的提示词；单台失败不影响其余。 */
export async function loadAllPrompts(): Promise<McpPromptItemView[]> {
  let servers: McpServerView[];
  try {
    const list = await listServers();
    if (!Array.isArray(list)) return [];
    servers = list;
  } catch {
    return [];
  }
  const out: McpPromptItemView[] = [];
  await Promise.all(
    servers
      .filter((s) => s.enabled)
      .map(async (s) => {
        try {
          const prompts = await listPrompts(s.id);
          for (const p of prompts) {
            out.push({ ...p, server_id: s.id, server_name: s.name });
          }
        } catch {
          /* 单台服务器不可用不影响其他候选项 */
        }
      }),
  );
  return out.sort((a, b) =>
    `${a.server_name}/${a.name}`.localeCompare(`${b.server_name}/${b.name}`),
  );
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
  policy: McpServerPolicy;
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

/** 单独调整信任分级 / 连接策略（会触发重连，后端写安全事件）。 */
export function setServerPolicy(
  id: number,
  policy: McpServerPolicy,
): Promise<McpServerView> {
  return invoke("mcp_set_server_policy", { id, policy });
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

// ── prompts 域（v0.8.1 M2-06）──────────────────────────────

export function listPrompts(id: number): Promise<McpPromptView[]> {
  return invoke("mcp_list_prompts", { id });
}

export function getPrompt(
  id: number,
  name: string,
  args: Record<string, string>,
): Promise<McpPromptMessageView[]> {
  return invoke("mcp_get_prompt", { id, name, arguments: args });
}
