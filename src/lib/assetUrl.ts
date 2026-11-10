/**
 * 绝对路径 -> asset:// URL（v0.8.0，C53 已把工作区与白名单目录注册进资产协议 scope）。
 *
 * 文件面板（C54）与消息流图片（C55）预览都走这一条通道：直接拿后端给的
 * 绝对路径拼 `asset://localhost/<path>`，资产协议侧会自行 canonicalize 命中 scope，
 * 没必要在前端保留 `\\?\` 之类的前缀。
 */
export function assetUrl(absPath: string): string {
  const norm = absPath.replace(/\\/g, "/");
  return `asset://localhost/${encodeURI(norm)}`;
}
