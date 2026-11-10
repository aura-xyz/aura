[简体中文](../../README.md) | [繁體中文](./README.zh-TW.md) | **English** | [日本語](./README.ja.md) | [Español](./README.es.md) | [Português](./README.pt.md)

<p align="center">
  <img src="../../logo.png" width="128" alt="Aura" />
</p>

<h1 align="center">Aura</h1>

<p align="center">
  <img src="https://img.shields.io/badge/license-Apache--2.0-blue.svg" alt="License" />
  <img src="https://img.shields.io/badge/version-v0.8.0--rc.2-blue.svg" alt="Version" />
  <img src="https://img.shields.io/badge/platform-Windows%20%7C%20Linux-lightgrey.svg" alt="Platform" />
  <img src="https://img.shields.io/badge/Tauri-2.0-orange.svg" alt="Tauri" />
</p>

Aura is a **local-first desktop AI agent**. It brings chat, file read/write, command execution, skills and MCP servers into one lightweight desktop app. Conversations, keys and settings stay on your machine.

> Minimal surface. Maximum logic.

## Why Aura

- **Local first**: sessions, keys and settings live in a local SQLite database. Keys are encrypted with the OS keyring / DPAPI (Linux falls back to app-level encryption and says so) — no relay server.
- **It actually does things**: built-in tools for reading, writing, searching and running commands. Three modes enforce permissions in code, not just in a prompt.
- **Extensible but contained**: skills load on demand; MCP servers add external tools, but every call goes through approval and security rules.
- **Desktop details**: tray residency, system notifications, window state, drag & drop, command palette, multi-source auto-update.

## Highlights in v0.8.0

- **UI overhaul**: unified semantic colors with contrast gates; sessions grouped by time; tree file panel with split previews; right-panel tab rail; `Ctrl+K` command palette.
- **Input & messages**: paste/drop images as attachments; context water level; regenerate with version switching; code block toolbar and diffs.
- **Security**: single source of truth for command rules; approval flow for dangerous commands; security events panel; masked keys with explicit clearing.
- **MCP (part 1)**: stdio server CRUD and status, tool discovery with name-conflict rewriting, per-workspace visibility, per-server enablement; MCP tools are Exec-only and require approval.
- **Linux fixes**: autostart argument, window corners, open-with list and editor icons, keystore write fallback so model switching works.
- **Mirrors**: updates and the official skill market race 7 built-in mirrors; custom skill sources can use their own mirror prefix.

## Features

### Chat

Streaming output with stop and automatic model fallback; context compression near the limit. Regenerate and edit-and-resend with version history. Turn rail navigation, global search, copy, folding and diff views. Timestamps in the session list can be turned off in Appearance.

### Models

17 cloud provider presets plus Azure OpenAI and custom OpenAI-compatible endpoints; Ollama and llama.cpp locally; model catalog with favorites; automatic fallback chain.

### Tools & workspace

Read-only tools (`list_files`, `read_file`, `search_workspace`), write tools (`write_file`, `string_replace`, `replace_lines`) and `run_script`. Multiple workspaces and sessions, path allowlist, operation timeline, task checklist.

### Skills & MCP

`SKILL.md` skills load on demand and can only narrow permissions. Skill market with pre-install inspection; GitHub or SkillHub sources. MCP part 1: stdio servers, connection status, tool discovery and `list_changed` rescan, conflict rewriting, workspace scoping, per-server toggles. MCP tools require approval and emit `mcp_call` security events.

### Security & privacy

Masked API keys, separate clearing, encrypted at rest. One rule source shared by install inspection and runtime blocking. Security event viewer with export.

### Desktop

Tray (close = minimize), notifications only when unfocused, remembered window state, thin scrollbars, context menus, file drop, image paste, multi-mirror auto-update.

## Modes

| Mode | Purpose | Read | Write | Exec |
| --- | --- | :---: | :---: | :---: |
| Chat | Q&A only | ✓ | — | — |
| Plan | Produce a plan | ✓ | — | — |
| Build | Do the work | ✓ | ✓ | ✓ |

Permissions are enforced in code; blocked calls explain how to switch modes instead of failing silently. Expensive tools such as MCP tools are injected only in Build mode.

## Built-in providers

International: OpenRouter, OpenAI, DeepSeek, Groq, xAI Grok, Together AI, Azure OpenAI.  
China: Zhipu GLM, Moonshot Kimi, MiniMax, SiliconFlow, Yi, Baichuan, StepFun, Alibaba Bailian (Qwen), Volcengine Ark (Doubao), Tencent Hunyuan.  
Local: Ollama, llama.cpp server. Custom OpenAI-compatible endpoints are supported.

## Install

Download from [Releases](https://github.com/aura-xyz/aura/releases):

- **Windows x64**: `Aura_<version>_win_x64_Setup.exe`
- **Linux x64 Debian/Ubuntu**: `aura_<version>_amd64.deb`
- **Linux x64 universal**: `aura_<version>_amd64.AppImage` (in-app auto-update works for AppImage only)
- **Linux deps**: WebKitGTK 4.1 and libsecret

## Build from source

```bash
pnpm install
pnpm tauri dev
pnpm tauri build
```

## Configuration

Settings → Models: pick a provider, enter the key, fetch and favorite models. Settings → General: allowlist, global rules, custom skill mirror. Settings → Appearance: theme, font size, live Markdown, session timestamps. Settings → Security: security events.

## Contributing

Issues and pull requests are welcome. Please read [CONTRIBUTING](../../CONTRIBUTING.md) and [CODE_OF_CONDUCT](../../CODE_OF_CONDUCT.md) first.

## License

[Apache License 2.0](../../LICENSE).
