import { Sparkles } from "lucide-react";
import PlaceholderPage from "./PlaceholderPage";

interface Props {
  onClose: () => void;
}

export default function SkillsPage({ onClose }: Props) {
  return (
    <PlaceholderPage
      icon={Sparkles}
      title="Skills"
      description="把常用操作沉淀为可复用的技能包，让模型在合适的场景下自动调用，而不必每次在提示词里重复描述。"
      planned={[
        "技能的定义与存放位置（跟随工作区还是全局）",
        "在会话中查看本次触发了哪些技能",
        "手动启用 / 禁用某个技能",
        "技能内的工具调用权限边界",
      ]}
      onClose={onClose}
    />
  );
}