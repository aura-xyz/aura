[简体中文](./README.md) | **English** | [日本語](./README-ja.md) | [Español](./README-es.md) | [Português](./README-pt.md)

<p align="center">
  <img src="./logo.png" width="128" alt="Aura" />
</p>

<h1 align="center">Aura</h1>

<p align="center">
  <img src="https://img.shields.io/badge/license-Apache--2.0-blue.svg" alt="License" />
  <img src="https://img.shields.io/badge/version-v0.6.3-blue.svg" alt="Version" />
  <img src="https://img.shields.io/badge/platform-Windows-lightgrey.svg" alt="Platform" />
  <img src="https://img.shields.io/badge/Tauri-2.0-orange.svg" alt="Tauri" />
</p>

A local-first desktop AI Agent, built with Tauri 2.0 + React 19 + TypeScript. Connect to many cloud model providers and local inference engines; sessions, credentials, and settings all stay on your machine.

## Features

- **Multiple providers**: 17 built-in provider presets (OpenRouter, OpenAI, DeepSeek, Moonshot Kimi, Zhipu GLM, MiniMax, SiliconFlow, 01.AI, Baichuan, StepFun, Groq, xAI, Together, Alibaba Bailian, Volcano Ark, Tencent Hunyuan, plus custom OpenAI-compatible endpoints). Official API base URLs are filled in automatically when you pick a provider.
- **Local models**: Ollama and llama.cpp server support — probe service status, pull models, and watch download progress from within the app.
- **Model catalog & favorites**: fetch the full model list for a provider in one click, search and star your favorites; favorites are grouped by provider and switchable from the chat page at any time.
- **Three working modes**: Chat, Plan, and Build, switched via the tabs. The mode in effect is the one selected when you send each message.
- **Task checklist**: Plan mode produces executable steps shown in the sidebar; Build mode advances them step by step with live status updates.
- **Multi-workspace sessions**: the sidebar organizes sessions by workspace — create, switch, and delete; right-click context menu and inline rename (no disk files are touched). Once the first message is sent, the workspace is locked: each conversation maps to exactly one workspace.
- **Automatic fallback**: when the primary model is rate-limited or fails, Aura switches down the fallback chain to the next available model and explains why.
- **Streaming output**: SSE incremental rendering with a typewriter effect; generation can be stopped at any time.
- **Complete toolset**: `list_files` / `read_file` / `search_workspace` for reading and search, `write_file` / `string_replace` / `replace_lines` for editing, `run_script` for running commands — with live action cards, retry on failure, and diagnostic notices.
- **Context management**: history is compressed automatically as it approaches the context limit so long conversations never break; the task checklist is stored separately and survives compression.
- **Path allowlist**: beyond the workspace, you can authorize other directories for the model to read and write (the skill directory, so it can maintain its own skills). System directories and key directories are **always refused**; folders like `Desktop` or `Documents` ask you first.
- **Operation timeline**: the sidebar's “Trace” view records every step of the current conversation — which tools were called, with what arguments, how long they took, and where something was blocked. Isolated per conversation, searchable, exportable as Markdown.
- **Skills**: reusable instructions written as `SKILL.md` files in the workspace or on this machine. The model loads them on demand, so unloaded skills cost no context, and a skill can only narrow permissions — it can never bypass the mode limits. The Skills page lists every skill with its source (workspace / local / market / built-in) and lets you enable, disable or delete them. Three skills ship built in: `docx` (create/edit Word documents, tracked changes, comments), `pdf` (read/merge/forms/OCR) and `skill-creator` (how to write your own). The skill market installs in one click, but **inspects the package first**: it lists the permissions the skill asks for plus any dangerous commands or prompt-injection lines it contains, and you decide. You can also add any GitHub repository as an extra source, or plug in a third-party skill library like SkillHub (**filter by source, search within it**).
- **Settings page**: collapsible sidebar; settings cover appearance, model services, and general options, with light/dark theme switching and global rules.
- **Local persistence**: session history, task checklists, and settings live in a local SQLite database; API keys are encrypted at rest with Windows DPAPI — nothing depends on the cloud.

## Working Modes

Pick a mode from the tabs. **The mode in effect is the one selected when you send each message, and you can change it at any time.** The three modes differ in what actions they permit and how the prompt is tuned:

| Mode | Purpose | Read files | Modify files | Run commands | Focus |
| --- | --- | :---: | :---: | :---: | --- |
| Chat | Pure Q&A | ✓ | — | — | Answer directly, no workflow |
| Plan | Produce a plan | ✓ | — | — | Investigate first, then give executable steps |
| Build | Get things done | ✓ | ✓ | ✓ | Advance the checklist step by step with live progress |

Permissions are enforced by the program itself: even if the model tries to call a write-class tool in Chat or Plan mode, the call is intercepted with a prompt to switch to Build mode — never a silent failure.

The checklist clears automatically once all steps are complete, and is saved with the session, restoring after a restart.

> **Behavior change notices**
>
- v0.7.0 (in development, not yet released):
  - Messages support "regenerate" and "edit & resend": both roll the context back before resending, so nothing stale is left behind
  - Regenerating keeps the old version, and you can switch between them (switching only changes the display; later turns still build on the newest version)
  - Right-click the message area to copy a whole reply; code blocks get a one-click copy button
  - File edits can be expanded into a diff view that marks added and removed lines
  - Code blocks over 20 lines are collapsed by default
  - Dropping a file into the window attaches its path to the input; system and key directories are refused, and directories needing authorization are called out
  - The window can live in the system tray and keep running in the background, with a system notification when a task finishes (only while the window is not in front)
  - Ctrl+F opens in-app session search
  - The empty state now shows example cards that fill a starter prompt into the input
  - Closing the window now minimizes it to the tray; use "Quit Aura" in the about page to exit fully
  - Updates now download from multiple sources and pick the fastest one automatically (GitHub downloads are extremely slow in mainland China)
  - Type `@` in the input to pop up the workspace file list; type `/` to pop up the enabled skills list. Picking one inserts it into the input
  - The start screen is now one centered block: icon and title, then the input, then the examples
> - v0.6.3:
>   - Visual refresh: new success / warning / brand semantic colors, and every dark-mode contrast ratio now meets the 4.5:1 accessibility standard.
>   - Your messages use a brand-blue background so they stand out from AI replies; the current sidebar session is brand-marked too.
>   - Tool rows show a result color dot and elapsed time, with a brand spinner while running.
>   - One-click copy for messages and code blocks (appears on hover), with visible copy feedback.
>   - Right-clicking the message area is no longer a dead end: copy a whole message, or copy a code block.
>   - Thinner scrollbars — the UI no longer looks like a web page.
>   - Window position and size are remembered and restored on relaunch.
>   - F5 / Ctrl+R are intercepted, no more white flash.
>   - Input drafts are kept per conversation, so switching sessions never loses them; press Arrow Up in an empty box to recall your last message.
>   - Live token count in the bottom-right of the input box.
>   - The sidebar gains a Timeline entry, and the path allowlist section uses warning colors (v0.6.2 screens brought into the same visual language).
> - v0.6.1:
>   - The Skills page is live: see each skill's source, version and allowed tools, then enable, disable or delete it (built-in and workspace skills cannot be deleted).
>   - New skill market: install skills from the official registry in one click; every package is verified against its sha256.
>   - Pre-install audit: shows the permissions a skill asks for and any high-risk patterns in the package (deletion commands, credential access, prompt injection) — high-risk findings need a second confirmation.
>   - Any GitHub repository can be added as an extra skill source; installed skills can be updated in place, and files you added to a skill directory are preserved.
>   - Fixed "check for updates" failing every time (the release manifest had been malformed since v0.5.0 — not a network problem).
> - v0.6.0:
>   - Once the first message is sent in a conversation, its workspace can no longer be changed (one conversation maps to exactly one workspace).
>   - Redesigned input area: the mode switcher and model picker now live inside the input card for a more compact layout.
>   - Code-block language labels moved to the top left; added highlighting for ini (TOML), Dockerfile, PowerShell, nginx, protobuf, and HTTP.
>   - API keys are now encrypted at rest (Windows DPAPI) instead of being stored in plaintext; after switching Windows users or reinstalling the system you will need to re-enter your keys.
> - Since v0.5.0: Chat mode changed from full access to read-only. After upgrading, switch to "Build" mode if you want Aura to modify files directly.
> - v0.5.2:
> - v0.6.2:
>   - Path allowlist: authorize other directories for the model to read and write; system and key directories are refused outright, privacy-sensitive folders need confirmation
>   - The skill market now supports multiple sources with per-source filtering, and connects to the third-party SkillHub library
>   - Installing from the market validates the tool names a skill declares; a skill with a typo can't be installed and you'll be told which name is wrong
>   - New operation timeline: records every step of a conversation, searchable and exportable as Markdown
>   - The workspace picker moved next to the model picker
>   - New sidebar entries for "New Chat", "Skills", and "MCP" — the latter two are reserved for upcoming features.
>   - Sidebar collapse and expand now use a smooth transition animation.
>   - The working directory is chosen when creating a new chat; messages cannot be sent until one is selected.
>   - Conversations under the same directory are automatically grouped.
>   - Fixed an issue where the first message after a restart could read the previous workspace directory.
> - v0.5.1:
>   - Fixed the UI freezing for a long time when running commands with lots of output (such as installing dependencies or compiling a project).
>   - Multiple tool calls can now be issued in a single turn and are executed in order, instead of waiting for each result before continuing.
>   - Fixed an ordering bug where action cards appeared before the main text when the model "spoke first, then called tools".
>   - Code blocks now show a language label in the top-right corner.
>   - Fixed an issue where clicking "Stop" after switching sessions would stop another session's task.
>   - Fixed two red warning styles that had no effect.

## Built-in Providers

| Category | Providers |
| --- | --- |
| International | OpenRouter, OpenAI, DeepSeek, Moonshot Kimi, Groq, xAI Grok, Together AI |
| China | Zhipu GLM, SiliconFlow, 01.AI Yi, Baichuan, StepFun, MiniMax, Alibaba Bailian Qwen, Volcano Ark Doubao, Tencent Hunyuan |
| Local | Ollama, llama.cpp server |
| Other | Azure OpenAI, custom OpenAI-compatible endpoints (custom request headers supported) |

All cloud providers are accessed through the OpenAI-compatible protocol, with built-in handling for non-`/v1` endpoint rules such as DeepSeek, Zhipu GLM, and Volcano Ark.

## Screenshots

### Welcome Page

![Welcome Page](assets/images/主页面——无对话.png)

### Basic Conversation

![Basic Conversation](assets/images/基础对话.png)

### Tool Calls

![Tool Call 1](assets/images/工具调用1.png)

![Tool Call 2](assets/images/工具调用2.png)

## Development

```bash
pnpm install
pnpm tauri dev
```

Frontend-only debugging:

```bash
pnpm dev
```

## Build

```bash
pnpm tauri build
```

## Configuration

Configure in the "Model Services" section of the settings page — one card per provider:

1. Pick a model provider (the official API base URL is filled in automatically)
2. Enter that provider's API key
3. Click "Fetch Model List" to pull available models, then search and star the ones you want to keep

Keys are stored only in the local SQLite database and are encrypted with Windows DPAPI (bound to the current Windows user); they are never uploaded to any third-party service. After switching Windows users or reinstalling the system, you will need to re-enter each provider's key.

Local models (Ollama / llama.cpp) need no API key — just make sure the local service is running.

> **About environment variables**: `OPENROUTER_API_KEY` is kept only as a historical compatibility fallback for OpenRouter; enter keys for other providers in the settings page.

## Tech Stack

- [Tauri 2.0](https://tauri.app) — Rust backend, window, and IPC
- React 19 + TypeScript + Vite — frontend
- Tailwind CSS v4 — styling (Pinguo Design System tokens)
- rusqlite — local storage
- reqwest — multi-provider HTTP access

## License

This project is open source under the [Apache License 2.0](LICENSE).
