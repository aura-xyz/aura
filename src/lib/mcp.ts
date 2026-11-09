/**
 * MCP（Model Context Protocol）服务器视图模型与命令契约（v0.8.0，C56 前端骨架）。
 *
 * **设计预览态**：后端 MCP 命令要到 rc.3 才落地。本模块先把类型、字段与命令契约
 * 定死，页面以「设计预览」运行（数据来自下面的 DEMO_SERVERS，改动只落在本地 state）。
 * 后端就绪后，把页面的数据源从 DEMO_SERVERS 换成 `invoke(MCP_COMMANDS.list)`、
 * 把各操作换成对应 invoke 即可实化——UI 与类型零重构。
 *
 * **安全口径**（必须与安全增强同批评审）：
 * - 工具白名单 `tools[].enabled` 决定哪些工具暴露给模型，UI 必须可见可改；
 * - 只读范围 `readOnly` + `scopes` 决定服务器可访问的目录，UI 必须可见可改；
 * - 后端对齐后，Exec 类工具自动进入统一审批分级（C40），前端不另写一套判定。
 */

export type McpStatus = "connected" | "disconnected" | "error";

/** 单条 MCP 工具视图。 */
export interface McpToolView {
  /** 工具名（服务器内的唯一标识） */
  name: string;
  description: string;
  /** 是否在启用白名单内。未勾选的工具不会暴露给模型。 */
  enabled: boolean;
  /** 是否需要审批（Exec / 写类工具由后端规则判定，前端仅展示） */
  requiresApproval?: boolean;
}

/** 一台 MCP 服务器视图。 */
export interface McpServerView {
  id: string;
  name: string;
  /** 传输方式：rc.3 只做 stdio */
  transport: "stdio";
  /** 启动命令（可执行文件或命令名） */
  command: string;
  args: string[];
  status: McpStatus;
  /** 逐服务器总开关：关闭后其工具全部不挂载 */
  enabled: boolean;
  /** 工具清单（含白名单勾选状态） */
  tools: McpToolView[];
  /** 只读模式：开启后禁写类工具（仍可读） */
  readOnly: boolean;
  /** 只读范围：允许工具访问的目录（空 = 仅工作区，不额外放开） */
  scopes: string[];
  /** 最近错误（最新在前，展示在详情抽屉） */
  recentErrors: string[];
  /** 最近一次连接成功时间（Unix 毫秒，0 表示从未连接） */
  lastConnectedAt: number;
}

/** 添加 / 编辑服务器时的输入（不含运行时状态）。 */
export type McpServerInput = Pick<
  McpServerView,
  "name" | "command" | "args" | "enabled" | "readOnly" | "scopes"
>;

/**
 * 后端命令契约（rc.3 实化时按此实现，前端调用签名不变）。
 *
 * 现在只在注释里固化，避免后端就绪后前后端各拍一套字段名。
 */
export const MCP_COMMANDS = {
  /** 列出全部服务器 → McpServerView[] */
  list: "mcp_list_servers",
  /** 新增服务器，入参 McpServerInput → McpServerView */
  add: "mcp_add_server",
  /** 更新服务器（含白名单 / 只读范围），入参 McpServerView → McpServerView */
  update: "mcp_update_server",
  /** 删除服务器，入参 { id } → void */
  remove: "mcp_remove_server",
  /** 连接 / 断开，入参 { id, connect: boolean } → McpServerView */
  connect: "mcp_connect_server",
} as const;

/** 状态 → 展示元信息（文案 + 颜色点）。 */
export const MCP_STATUS_META: Record<
  McpStatus,
  { label: string; dot: string; text: string }
> = {
  connected: { label: "已连接", dot: "bg-success", text: "text-success" },
  disconnected: { label: "未连接", dot: "bg-line", text: "text-subtle" },
  error: { label: "连接失败", dot: "bg-danger", text: "text-danger" },
};

/** 状态点 / 名称的辅助函数（纯函数，便于日后单测）。 */
export function commandSummary(server: Pick<McpServerView, "command" | "args">): string {
  return [server.command, ...server.args].join(" ");
}

/**
 * 设计预览用的示例数据。**不是真实连接**，仅供界面演示与契约核对。
 * 后端就绪后本常量可整体删除。
 */
export const DEMO_SERVERS: McpServerView[] = [
  {
    id: "demo-filesystem",
    name: "filesystem",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-filesystem", "/work"],
    status: "connected",
    enabled: true,
    readOnly: true,
    scopes: ["/work", "/work/docs"],
    recentErrors: [],
    lastConnectedAt: 0,
    tools: [
      { name: "read_file", description: "读取文件内容", enabled: true },
      { name: "list_directory", description: "列出目录条目", enabled: true },
      { name: "search_files", description: "按名称搜索文件", enabled: true },
      { name: "write_file", description: "写入文件（只读模式下禁用）", enabled: false, requiresApproval: true },
    ],
  },
  {
    id: "demo-github",
    name: "github",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-github"],
    status: "error",
    enabled: false,
    readOnly: false,
    scopes: [],
    recentErrors: [
      "启动失败：未找到环境变量 GITHUB_TOKEN",
      "连接超时（20s）：命令 npx 无响应",
    ],
    lastConnectedAt: 0,
    tools: [
      { name: "search_repositories", description: "搜索仓库", enabled: true },
      { name: "create_issue", description: "创建 issue", enabled: false, requiresApproval: true },
    ],
  },
];
