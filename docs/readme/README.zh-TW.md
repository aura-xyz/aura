[简体中文](../../README.md) | **繁體中文** | [English](./README.en.md) | [日本語](./README.ja.md) | [Español](./README.es.md) | [Português](./README.pt.md)

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

Aura 是一款**本機優先的桌面 AI Agent**。它把對話、檔案讀寫、指令執行、技能載入與 MCP 服務收進一個輕量桌面應用程式，工作階段、金鑰與設定全部保存在本機。

> Minimal surface. Maximum logic.

## 為何選擇 Aura

- **本機優先**：工作階段、金鑰、設定存於本機 SQLite；金鑰經系統金鑰環 / DPAPI 加密（Linux 無金鑰環時降級為應用程式內加密並明確標示），不經過任何中轉伺服器。
- **真的能做事**：內建檔案讀寫、全文檢索、指令執行等工具，三種模式以程式強制收窄權限，而非只在提示詞裡「請勿越權」。
- **可擴充而不失控**：技能（Skills）按需載入、只佔目前上下文；MCP 伺服器可接入外部工具，但一律走審批與安全規則。
- **桌面級細節**：系統匣常駐、系統通知、視窗狀態記憶、拖放檔案、全域命令面板、多來源自動更新。

## v0.8.0 版本亮點

- **介面重構**：統一語意色與對比度門檻；側欄工作階段依時間分組；檔案面板樹狀檢視與分流預覽；右欄頁籤軌道化；全域命令面板 `Ctrl+K`。
- **輸入與訊息**：圖片貼上／拖放為附件；上下文水位提示；訊息重新生成與多版本切換；程式碼區塊工具列與差異檢視。
- **安全強化**：指令風險規則單一資料來源；危險指令審批流程；設定頁「安全」分區可檢視／匯出安全事件；金鑰遮罩與單獨清除。
- **MCP 支援（第一部分）**：stdio 伺服器增刪改查與連線狀態、工具探索與同名衝突處理、依工作區限定可見、逐伺服器啟用；MCP 工具預設僅執行模式可見並進入審批分級。
- **Linux 相容性**：修正開機自動啟動參數、視窗圓角、開啟方式清單與編輯器圖示、金鑰環寫入失敗導致的模型切換失敗。
- **鏡像加速**：更新與官方技能市場統一走內建 7 家鏡像競速；自訂技能來源可設定獨立鏡像。

## 功能

### 對話體驗

串流輸出、隨時停止、自動降級至備用模型；上下文接近上限時自動壓縮。重新生成與「編輯後重跑」：回滾上下文重發；舊回答保留為版本，可左右切換回看。右側輪次刻度軌快速跳轉；`Ctrl+K` 全域命令面板統一搜尋動作／工作階段／技能／工作區檔案。訊息與程式碼區塊一鍵複製、程式碼折疊、檔案修改差異檢視。工作階段清單的時間戳記可在「外觀」關閉。

### 模型接入

內建 17 家雲端廠商預設與 Azure OpenAI、自訂 OpenAI 相容端點；選擇廠商自動填入官方位址。本機模型：Ollama 與 llama.cpp server，可在應用程式內探測狀態、拉取模型並查看進度。模型目錄與收藏：一鍵拉取廠商模型，搜尋並勾選；已收藏模型依廠商分組。自動降級鏈：主模型限流或故障時依序切換並提示原因。

### 工具與工作區

唯讀工具：`list_files`、`read_file`、`search_workspace`；寫入工具：`write_file`、`string_replace`、`replace_lines`；執行工具：`run_script`。多工作區多工作階段；路徑白名單；操作時間軸；任務清單（獨立保存，不隨上下文壓縮遺失）。

### 技能與 MCP

Skills：`SKILL.md` 放入工作區或本機即可按需載入；技能只能收窄權限。內建 `docx` / `pdf` / `skill-creator`。技能市場裝前靜態審查權限與危險寫法；支援任意 GitHub 儲存庫為來源，或接入 SkillHub。MCP（第一部分）：stdio 伺服器增刪改查、連線狀態與重連、工具探索與 `list_changed` 重掃、同名衝突自動改名、依工作區限定可見、逐伺服器啟用。MCP 工具預設 `Exec` 類，僅執行模式可見；呼叫前依最高審批檔確認（可依伺服器於本工作階段記住），並記錄 `mcp_call` 安全事件。

### 安全與隱私

API Key 遮罩回顯，支援單獨清除；落庫前加密。統一規則來源：安裝審查與執行時攔截共用同一套規則；危險指令硬拒或審批。安全事件面板：最近事件可篩選、匯出。

### 桌面整合

系統匣常駐（關閉視窗＝最小化）；任務完成時僅在視窗不在前景時發系統通知。視窗位置與大小記憶；細捲軸；右鍵選單。拖入檔案即附加路徑；圖片貼上／拖放為附件。自動更新多來源下載（內建 7 家鏡像競速，失敗回退直連）。

## 工作模式

| 模式 | 定位 | 可讀檔案 | 可改檔案 | 可執行指令 | 說明 |
| --- | --- | :---: | :---: | :---: | --- |
| 對話 | 純問答 | ✓ | — | — | 直接回答，不涉及流程 |
| 規劃 | 產出計畫 | ✓ | — | — | 先調研現況，再給出可執行步驟 |
| 執行 | 動手做事 | ✓ | ✓ | ✓ | 依任務清單逐步推進並更新進度 |

權限由程式強制校驗：在對話／規劃模式下呼叫寫入或執行類工具會被攔截並提示切換模式，而非靜默失敗。上下文開銷大的工具（如 MCP 工具）預設只在執行模式注入。

## 內建廠商

| 類別 | 廠商 |
| --- | --- |
| 國際 | OpenRouter、OpenAI、DeepSeek、Groq、xAI Grok、Together AI、Azure OpenAI |
| 中國 | 智譜 GLM、月之暗面 Kimi、MiniMax、矽基流動 SiliconFlow、零一萬物 Yi、百川智能、階躍星辰 Step、阿里百煉通義千問、火山方舟豆包、騰訊混元 |
| 本機 | Ollama、llama.cpp server |
| 其他 | 自訂 OpenAI 相容端點（可附加自訂請求標頭） |

所有雲端廠商均透過 OpenAI 相容協定接入；非 `/v1` 路徑的端點規則已內建處理。

## 安裝

從 [Releases](https://github.com/aura-xyz/aura/releases) 下載對應平台的安裝包：

- **Windows x64**：`Aura_<版本>_win_x64_Setup.exe`（安裝後可在應用程式內檢查更新）
- **Linux x64 · Debian/Ubuntu**：`aura_<版本>_amd64.deb`（`sudo apt install ./aura_<版本>_amd64.deb`）
- **Linux x64 · 通用**：`aura_<版本>_amd64.AppImage`（`chmod +x` 後直接執行；應用程式內自動更新僅 AppImage 可用）
- **Linux 依賴**：WebKitGTK 4.1 與 libsecret（系統金鑰服務用於加密保存 API Key）

## 從原始碼建置

```bash
pnpm install
pnpm tauri dev     # 開發
pnpm tauri build   # 打包（需簽章設定，見開發文件）
```

前端單獨除錯：`pnpm dev`。

## 設定與資料

1. 設定 →「模型服務」：選擇廠商、填寫 API Key、拉取並收藏模型。
2. 設定 →「通用」：路徑白名單、全域規則、自訂技能來源鏡像。
3. 設定 →「外觀」：主題、字級、輸入框 Markdown 即時渲染、工作階段清單時間戳記。
4. 設定 →「安全」：檢視與匯出安全事件。

工作階段與設定保存在本機 SQLite；金鑰經系統金鑰服務加密（Windows DPAPI / Linux SecretService，缺失時降級檔案加密）。更換系統使用者或重裝系統後需重新填寫金鑰。

## 參與貢獻

歡迎提交 Issue 與 Pull Request。開始之前請閱讀[貢獻指南](../../CONTRIBUTING.md)與[行為準則](../../CODE_OF_CONDUCT.md)。

## 技術堆疊

- [Tauri 2.0](https://tauri.app) — Rust 後端、視窗與 IPC
- React 19 + TypeScript + Vite — 前端
- Tailwind CSS v4 — 樣式（Pinguo Design System 權杖）
- rusqlite — 本機儲存
- reqwest — 多廠商 HTTP 接入

## 授權條款

本專案基於 [Apache License 2.0](../../LICENSE) 開源。
