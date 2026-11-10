[简体中文](../../README.md) | [繁體中文](./README.zh-TW.md) | [English](./README.en.md) | **日本語** | [Español](./README.es.md) | [Português](./README.pt.md)

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

Aura は**ローカルファーストのデスクトップ AI エージェント**です。会話、ファイルの読み書き、コマンド実行、スキル、MCP サーバーを 1 つの軽量デスクトップアプリにまとめます。会話・鍵・設定はすべて端末内に保存されます。

> Minimal surface. Maximum logic.

## Aura の特徴

- **ローカルファースト**：会話・鍵・設定はローカルの SQLite に保存。鍵は OS のキーリング / DPAPI で暗号化（Linux でキーリングが無い場合はアプリ内暗号化に降格し、その旨を明示）。中継サーバーはありません。
- **本当に作業する**：読み取り・書き込み・検索・コマンド実行のツールを内蔵。3 つのモードはコードで権限を強制します。プロンプトの指示だけに頼りません。
- **拡張しつつ統制**：スキルは必要時に読み込み、MCP サーバーは外部ツールを追加しますが、すべて承認と安全ルールを通ります。
- **デスクトップらしさ**：常駐トレイ、システム通知、ウィンドウ状態の記憶、ドラッグ＆ドロップ、コマンドパレット、複数ミラーによる自動更新。

## v0.8.0 のハイライト

- **UI 刷新**：意味色の統一とコントラスト検査、会話の時間グループ化、ツリー式ファイルパネルとプレビュー、右パネルのタブレール、`Ctrl+K` コマンドパレット。
- **入力とメッセージ**：画像の貼り付け／ドロップを添付に、コンテキスト水位、再生成とバージョン切替、コードブロックのツールバーと差分表示。
- **セキュリティ強化**：コマンド規則の単一ソース化、危険コマンドの承認フロー、セキュリティイベント画面、鍵のマスク表示と個別削除。
- **MCP（第 1 部）**：stdio サーバーの CRUD と接続状態、ツール検出、同名衝突の自動改名、ワークスペース単位の公開範囲、サーバー単位の有効化。MCP ツールは Exec のみで承認必須。
- **Linux 対応**：自動起動の引数、ウィンドウの角丸、アプリで開く一覧とアイコン、キーリング書き込み失敗時のモデル切替を修正。
- **ミラー**：更新と公式スキル市場は内蔵 7 ミラーで競争選択。カスタムスキル源には独自ミラーを設定可能。

## 機能

### 会話

ストリーミング出力、停止、モデル自動フォールバック、上限付近でのコンテキスト圧縮。再生成と編集して再送（バージョン履歴付き）。ターンレール、グローバル検索、コピー、折りたたみ、差分表示。会話リストの時刻表示は「外観」でオフにできます。

### モデル

17 社のクラウドプリセットに加え Azure OpenAI と OpenAI 互換エンドポイント。Ollama / llama.cpp のローカル実行。モデルカタログとお気に入り。自動フォールバック。

### ツールとワークスペース

読み取り（`list_files`、`read_file`、`search_workspace`）、書き込み（`write_file`、`string_replace`、`replace_lines`）、`run_script`。複数ワークスペースと会話、パス許可リスト、操作タイムライン、タスクリスト。

### スキルと MCP

`SKILL.md` スキルは必要時に読み込まれ、権限を狭めることしかできません。市場はインストール前検査付き。GitHub や SkillHub を追加可能。MCP 第 1 部は stdio サーバー、接続状態、ツール検出と `list_changed` 再スキャン、衝突改名、ワークスペース制限、サーバー単位の切替。MCP 呼び出しは承認と `mcp_call` 記録の対象です。

### 安全とプライバシー

API キーはマスク表示・個別削除・暗号化保存。インストール検査と実行時ブロックが同じ規則源を共有。セキュリティイベントの閲覧とエクスポート。

### デスクトップ

トレイ常駐（閉じる＝最小化）、非フォーカス時のみ通知、ウィンドウ状態の記憶、細いスクロールバー、右クリックメニュー、ファイルドロップ、画像貼り付け、複数ミラー更新。

## モード

| モード | 用途 | 読取 | 書込 | 実行 |
| --- | --- | :---: | :---: | :---: |
| 会話 | 質疑応答のみ | ✓ | — | — |
| 計画 | 計画の作成 | ✓ | — | — |
| 実行 | 実際の作業 | ✓ | ✓ | ✓ |

権限はコードで強制され、拒否時はモード切替の案内を返します。MCP のような負荷の高いツールは実行モードでのみ注入されます。

## 内蔵プロバイダー

国際：OpenRouter、OpenAI、DeepSeek、Groq、xAI Grok、Together AI、Azure OpenAI。
中国：智谱 GLM、Moonshot Kimi、MiniMax、SiliconFlow、零一万物 Yi、百川智能、階躍星辰 Step、Alibaba Bailian（Qwen）、Volcengine Ark（Doubao）、Tencent Hunyuan。
ローカル：Ollama、llama.cpp server。OpenAI 互換のカスタムエンドポイントにも対応。

## インストール

[Releases](https://github.com/aura-xyz/aura/releases) から取得してください。

- **Windows x64**：`Aura_<version>_win_x64_Setup.exe`
- **Linux x64 Debian/Ubuntu**：`aura_<version>_amd64.deb`
- **Linux x64 汎用**：`aura_<version>_amd64.AppImage`（アプリ内自動更新は AppImage のみ）
- **Linux 依存**：WebKitGTK 4.1 と libsecret

## ソースからビルド

```bash
pnpm install
pnpm tauri dev
pnpm tauri build
```

## 設定

設定 →「モデル」：プロバイダー選択、キー入力、モデル取得とお気に入り。設定 →「一般」：許可リスト、グローバル規則、カスタムスキルミラー。設定 →「外観」：テーマ、文字サイズ、Markdown リアルタイム表示、会話時刻。設定 →「セキュリティ」：イベント閲覧。

## コントリビュート

Issue と Pull Request を歓迎します。まず [CONTRIBUTING](../../CONTRIBUTING.md) と [CODE_OF_CONDUCT](../../CODE_OF_CONDUCT.md) をお読みください。

## ライセンス

[Apache License 2.0](../../LICENSE)。
