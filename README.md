**简体中文** | [繁體中文](./docs/readme/README.zh-TW.md) | [English](./docs/readme/README.en.md) | [日本語](./docs/readme/README.ja.md) | [Español](./docs/readme/README.es.md) | [Português](./docs/readme/README.pt.md)

<p align="center">
  <img src="./logo.png" width="128" alt="Aura" />
</p>

<h1 align="center">Aura</h1>

<p align="center">
  <img src="https://img.shields.io/badge/license-Apache--2.0-blue.svg" alt="License" />
  <img src="https://img.shields.io/badge/version-v0.8.0-blue.svg" alt="Version" />
  <img src="https://img.shields.io/badge/platform-Windows%20%7C%20Linux-lightgrey.svg" alt="Platform" />
  <img src="https://img.shields.io/badge/Tauri-2.0-orange.svg" alt="Tauri" />
</p>

Aura 是一款**本地优先的桌面 AI Agent**。它把「对话、读写文件、执行命令、加载技能、连接 MCP 服务」收进一个轻量桌面应用里，会话、密钥与配置全部保存在本机。

> Minimal surface. Maximum logic.

## 为什么是 Aura

- **本地优先**：会话、密钥、配置存于本地 SQLite；密钥经系统密钥环 / DPAPI 加密（Linux 无密钥环时降级为应用内加密并明示强度），不经过任何中转服务器。
- **真正能做事**：内置文件读写、全文检索、命令执行等工具，三种模式用程序强制收窄权限，而不是只在提示词里「请勿越权」。
- **可扩展而不失控**：技能（Skills）按需加载、只占当前上下文；MCP 服务器可接入外部工具，但一律走审批与安全规则。
- **桌面级细节**：托盘常驻、系统通知、窗口状态记忆、拖放文件、全局命令面板、多源自动更新。

## 版本亮点（v0.8.0）

- **界面重构**：统一语义色与对比度门禁；侧栏会话按时间分组；文件面板树形视图与分流预览；右栏页签轨道化；全局命令面板 `Ctrl+K`。
- **输入与消息**：图片粘贴/拖放为附件；上下文水位提示；消息重新生成与多版本切换；代码块工具条带与差异视图。
- **安全增强**：命令风险规则单一数据源；危险命令审批流；设置页「安全」分区可查/导出安全事件；密钥掩码与单独清除。
- **MCP 支持（第一部分）**：stdio 服务器增删改查与连接状态、工具发现与同名冲突处理、按工作区限定可见、逐服务器启用；MCP 工具默认仅执行模式可见并进入审批分级。
- **Linux 兼容性**：修复开机自启参数、窗口圆角、打开方式列表与编辑器图标、密钥环写入失败导致的模型切换失败。
- **镜像加速**：更新与官方技能市场统一走内置 7 家镜像竞速；自定义技能源可配置独立镜像。

> 完整历史见 [Releases](https://github.com/aura-xyz/aura/releases)。

## 功能

### 对话体验

- 流式输出、随时停止、自动降级到备用模型；上下文接近上限时自动压缩。
- 重新生成与「编辑后重跑」：回滚上下文重发；旧回答保留为版本，可左右切换回看。
- 右侧轮次刻度轨快速跳转；`Ctrl+K` 全局命令面板统一搜索动作 / 会话 / 技能 / 工作区文件。
- 消息与代码块一键复制、代码折叠、文件修改差异视图。
- 支持为单条消息调整显示（时间戳可在设置页关闭，见「外观」）。

### 模型接入

- 内置 17 家云端厂商预设与 Azure OpenAI、自定义 OpenAI 兼容端点；选择厂商自动填入官方地址。
- 本地模型：Ollama 与 llama.cpp server，可在应用内探测状态、拉取模型并查看进度。
- 模型目录与收藏：一键拉取厂商模型，搜索并勾选；已收藏模型按厂商分组，对话页随时切换。
- 自动降级链：主模型限流或故障时按顺序切换，并提示降级原因。

### 工具与工作区

- 只读工具：`list_files`、`read_file`、`search_workspace`；写入工具：`write_file`、`string_replace`、`replace_lines`；执行工具：`run_script`。
- 多工作区多会话：侧栏按工作区组织；对话首条消息后锁定工作区。
- 路径白名单：可额外授权目录；系统目录与密钥目录永拒，隐私目录需确认。
- 操作时间线：按对话记录每一步工具调用（参数、耗时、拦截原因），可搜索、导出 Markdown。
- 任务清单：规划模式产出步骤，执行模式逐步推进；清单独立保存，不随上下文压缩丢失。

### 技能与 MCP

- **Skills**：`SKILL.md` 放进工作区或本机即可被按需加载；技能只能收窄权限。内置 `docx` / `pdf` / `skill-creator`。
- 技能市场：装前静态审查权限与危险写法；支持添加任意 GitHub 仓库为来源，或接入 SkillHub。
- **MCP（第一部分）**：stdio 服务器增删改查、连接状态与重连、工具发现与 `list_changed` 重扫、同名冲突自动改写、按工作区限定可见、逐服务器启用。
- MCP 工具默认 `Exec` 类，仅在执行模式可见；调用前按最高审批档确认（可按服务器本会话记住），并记录 `mcp_call` 安全事件。

### 安全与隐私

- API Key 掩码回显，支持单独清除；落库前加密。
- 统一规则源：安装审查与运行时拦截共用同一套规则；危险命令硬拒或审批。
- 安全事件面板：最近事件可筛选、导出。

### 桌面集成

- 托盘常驻（关闭窗口=最小化）；任务完成时仅在窗口不在前台时发系统通知。
- 窗口位置与大小记忆；细滚动条；右键菜单。
- 拖入文件即附加路径；图片粘贴/拖放为附件。
- 自动更新多源下载（内置 7 家镜像竞速，失败回退直连）。

## 工作模式

| 模式 | 定位 | 可读文件 | 可改文件 | 可执行命令 | 说明 |
| --- | --- | :---: | :---: | :---: | --- |
| 对话 | 纯问答 | ✓ | — | — | 直接回答，不涉及流程 |
| 规划 | 产出计划 | ✓ | — | — | 先调研现状，再给出可执行步骤 |
| 执行 | 动手做事 | ✓ | ✓ | ✓ | 按任务清单逐步推进并更新进度 |

权限由程序强制校验：在对话/规划模式下调用写入或执行类工具会被拦截并提示切换模式，而非静默失败。上下文开销大的工具（如 MCP 工具）默认只在执行模式注入。

## 内置厂商

| 类别 | 厂商 |
| --- | --- |
| 国际 | OpenRouter、OpenAI、DeepSeek、Groq、xAI Grok、Together AI、Azure OpenAI |
| 国内 | 智谱 GLM、月之暗面 Kimi、MiniMax、硅基流动 SiliconFlow、零一万物 Yi、百川智能、阶跃星辰 Step、阿里百炼通义千问、火山方舟豆包、腾讯混元 |
| 本地 | Ollama、llama.cpp server |
| 其他 | 自定义 OpenAI 兼容端点（可附加自定义请求头） |

所有云端厂商均通过 OpenAI 兼容协议接入；非 `/v1` 路径的端点规则已内置处理。

## 安装

从 [Releases](https://github.com/aura-xyz/aura/releases) 下载对应平台的安装包：

- **Windows x64**：`Aura_<版本>_win_x64_Setup.exe`（安装后可在应用内检查更新）
- **Linux x64 · Debian/Ubuntu**：`aura_<版本>_amd64.deb`（`sudo apt install ./aura_<版本>_amd64.deb`）
- **Linux x64 · 通用**：`aura_<版本>_amd64.AppImage`（`chmod +x` 后直接运行；应用内自动更新仅 AppImage 可用）
- **Linux 依赖**：WebKitGTK 4.1 与 libsecret（系统密钥服务用于加密保存 API Key）

## 从源码构建

```bash
pnpm install
pnpm tauri dev     # 开发
pnpm tauri build   # 打包（需签名配置，见开发文档）
```

前端单独调试：`pnpm dev`。

## 配置与数据

1. 设置 →「模型服务」：选择厂商、填写 API Key、拉取并收藏模型。
2. 设置 →「通用」：路径白名单、全局规则、自定义技能源镜像。
3. 设置 →「外观」：主题、字号、输入框 Markdown 实时渲染、会话列表时间戳。
4. 设置 →「安全」：查看与导出安全事件。

会话与配置保存在本地 SQLite；密钥经系统密钥服务加密（Windows DPAPI / Linux SecretService，缺失时降级文件加密）。更换系统用户或重装系统后需重新填写密钥。

## 截图

![欢迎页](assets/images/主页面——无对话.png)

![基础对话](assets/images/基础对话.png)

![工具调用](assets/images/工具调用1.png)

## 参与贡献

欢迎提交 Issue 与 Pull Request。开始之前请阅读 [贡献指南](./CONTRIBUTING.md) 与 [行为准则](./CODE_OF_CONDUCT.md)。

## 技术栈

- [Tauri 2.0](https://tauri.app) — Rust 后端、窗口与 IPC
- React 19 + TypeScript + Vite — 前端
- Tailwind CSS v4 — 样式（Pinguo Design System 令牌）
- rusqlite — 本地存储
- reqwest — 多厂商 HTTP 接入

## 许可证

本项目基于 [Apache License 2.0](LICENSE) 开源。
