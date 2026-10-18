import { Plug } from "lucide-react";
import PlaceholderPage from "./PlaceholderPage";

interface Props {
  onClose: () => void;
}

export default function McpPage({ onClose }: Props) {
  return (
    <PlaceholderPage
      icon={Plug}
      title="MCP"
      description="接入 Model Context Protocol 服务，让 Aura 能使用工作区之外的能力与数据源。"
      planned={[
        "MCP 服务端的增删改查与连接状态",
        "工具列表的发现与展示",
        "服务端工具与内置工具的同名冲突处理",
        "按工作区限定可见的 MCP 服务",
      ]}
      onClose={onClose}
    />
  );
}