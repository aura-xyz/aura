# 贡献指南（Contributing）

感谢你愿意参与 Aura。提交 Issue 或 Pull Request 前，请先阅读本指南与 [行为准则](./CODE_OF_CONDUCT.md)。

## 提交 Issue

- 先搜索是否已有相同问题。
- 描述要可复现：**版本号、操作系统、复现步骤、期望结果、实际结果**，能附日志或截图更好。
- 安全漏洞请勿公开提交 Issue，改用仓库的私密报告渠道（Security → Report a vulnerability）。

## 开发环境

| 项 | 要求 |
| --- | --- |
| 技术栈 | Tauri 2 + Rust + React 19 + TypeScript |
| 包管理 | pnpm |
| 前端构建 | Vite 8 + Tailwind CSS 4 |
| 本地存储 | SQLite（rusqlite） |

```bash
pnpm install
pnpm tauri dev     # 启动桌面应用
pnpm dev           # 仅前端调试（浏览器）
```

Linux 还需安装 WebKitGTK 4.1 与 libsecret 的开发包。

## 分支与提交

- 从 `main` 切出特性分支：`feat/<主题>`、`fix/<主题>`。
- **一个功能面一次提交**，发版（版本号）与功能改动分开。
- 提交信息格式：`type(scope): 中文描述`
  - `type`：`feat` / `fix` / `refactor` / `perf` / `test` / `docs` / `chore`
  - `scope`：模块名，如 `mcp`、`tools`、`ui`、`settings`、`release`
- 提交正文保持简短（不超过 3 行），说明「为什么」与关键取舍。

示例：

```
feat(mcp): tools/list 发现缓存与 list_changed 重扫

握手后翻页拉取工具集，收到变更通知自动重扫并同步注册表。
```

## 代码风格

- 前端：TypeScript 严格模式；组件保持单一职责；原子样式基于现有设计令牌，不新增一次性颜色。
- Rust：模块按职责拆分，公开 API 带注释；错误统一用 `Result<_, String>` 并给出可读原因。
- 注释解释**为什么**，不解释「这行做了什么」。
- 涉及安全的改动必须说明威胁模型与边界。

## 测试与门禁

提交前请确保以下命令全部通过：

```bash
# 后端
cd src-tauri && cargo test

# 前端
pnpm test          # vitest
pnpm build         # 生产构建
```

说明：

- 本机 `HTTP_PROXY` 指向本地代理时，Rust 测试需带 `NO_PROXY=127.0.0.1,localhost`，否则个别网络用例会确定性失败。
- 新增行为请补充测试；修复缺陷请补一条能复现该缺陷的用例。

## Pull Request

1. 描述问题与方案，关联相关 Issue。
2. 列出验证方式（命令、手动场景、截图）。
3. 保持改动聚焦；无关重构另开 PR。
4. CI 或本地门禁必须为绿；有失败项请在 PR 中说明原因与后续计划。
5. 维护者可能会请求调整；讨论未达成前请勿反复强制推送覆盖评审意见。

## 发布

发布由维护者负责：升版本号 → 打 tag → 构建与签名 → 上传资产与更新清单。贡献者无需改动版本号与发布清单。

## 许可证

提交代码即表示你同意以 [Apache License 2.0](./LICENSE) 授权你的贡献。
