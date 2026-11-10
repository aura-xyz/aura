[简体中文](../../README.md) | [繁體中文](./README.zh-TW.md) | [English](./README.en.md) | [日本語](./README.ja.md) | [Español](./README.es.md) | **Português**

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

Aura é um **agente de IA de desktop com foco local**. Reúne conversa, leitura/escrita de arquivos, execução de comandos, skills e servidores MCP em um app leve. Conversas, chaves e configurações ficam na sua máquina.

> Minimal surface. Maximum logic.

## Por que Aura

- **Local primeiro**: sessões, chaves e ajustes em SQLite local. As chaves são cifradas com o chaveiro do sistema / DPAPI (no Linux, criptografia interna quando não há chaveiro, com aviso). Sem servidor intermediário.
- **Faz o trabalho**: ferramentas integradas para ler, escrever, buscar e executar comandos. Os três modos impõem permissões em código, não apenas no prompt.
- **Extensível com controle**: skills carregam sob demanda; servidores MCP adicionam ferramentas externas, mas toda chamada passa por aprovação e regras de segurança.
- **Detalhes de desktop**: bandeja, notificações, memória de janela, arrastar e soltar, paleta de comandos, atualização automática multi-fonte.

## Novidades da v0.8.0

- **Nova interface**: cores semânticas com verificação de contraste, sessões agrupadas por tempo, painel de arquivos em árvore com prévias, abas do painel direito, paleta `Ctrl+K`.
- **Entrada e mensagens**: colar/arrastar imagens como anexos, nível de contexto, regenerar com histórico de versões, barra de código e diffs.
- **Segurança**: regras de comando com fonte única, fluxo de aprovação, painel de eventos, chaves mascaradas com remoção separada.
- **MCP (parte 1)**: CRUD de servidores stdio e status, descoberta de ferramentas com renomeação por conflito, visibilidade por workspace, ativação por servidor; ferramentas MCP são Exec e exigem aprovação.
- **Correções no Linux**: argumento de inicialização automática, cantos da janela, lista «abrir com» e ícones, e fallback do chaveiro para trocar de modelo.
- **Espelhos**: atualizações e mercado oficial competem entre 7 espelhos integrados; fontes personalizadas podem usar seu próprio espelho.

## Recursos

### Conversa

Saída em streaming com parada e fallback automático; compressão de contexto perto do limite. Regenerar e editar-e-reenviar com versões. Navegação por turnos, busca global, copiar, recolher e diffs. Os horários na lista de sessões podem ser desativados em Aparência.

### Modelos

17 provedores de nuvem, Azure OpenAI e endpoints compatíveis; Ollama e llama.cpp locais; catálogo com favoritos; cadeia de fallback.

### Ferramentas e workspace

Leitura (`list_files`, `read_file`, `search_workspace`), escrita (`write_file`, `string_replace`, `replace_lines`) e `run_script`. Vários workspaces e sessões, lista de caminhos permitidos, linha do tempo, lista de tarefas.

### Skills e MCP

Skills `SKILL.md` sob demanda que só podem restringir permissões. Mercado com inspeção prévia; fontes GitHub ou SkillHub. MCP parte 1: servidores stdio, status, descoberta e reescaneamento `list_changed`, renomeação por conflito, escopo por workspace, ativação por servidor. Chamadas MCP exigem aprovação e registram `mcp_call`.

### Segurança e privacidade

Chaves mascaradas, remoção separada e criptografia em repouso. Uma única fonte de regras para inspeção e bloqueio em execução. Visualizador de eventos com exportação.

### Desktop

Bandeja (fechar = minimizar), notificações apenas sem foco, estado da janela, barras finas, menus de contexto, arrastar arquivos, colar imagens, atualização multi-espelho.

## Modos

| Modo | Uso | Ler | Escrever | Executar |
| --- | --- | :---: | :---: | :---: |
| Conversa | Apenas perguntas | ✓ | — | — |
| Plano | Produzir um plano | ✓ | — | — |
| Execução | Executar o trabalho | ✓ | ✓ | ✓ |

As permissões são aplicadas em código; chamadas bloqueadas explicam como trocar de modo. Ferramentas caras como MCP só são injetadas no modo Execução.

## Provedores integrados

Internacionais: OpenRouter, OpenAI, DeepSeek, Groq, xAI Grok, Together AI, Azure OpenAI.
China: Zhipu GLM, Moonshot Kimi, MiniMax, SiliconFlow, Yi, Baichuan, StepFun, Alibaba Bailian (Qwen), Volcengine Ark (Doubao), Tencent Hunyuan.
Local: Ollama, llama.cpp server. Também endpoints compatíveis personalizados.

## Instalação

Baixe em [Releases](https://github.com/aura-xyz/aura/releases):

- **Windows x64**: `Aura_<version>_win_x64_Setup.exe`
- **Linux x64 Debian/Ubuntu**: `aura_<version>_amd64.deb`
- **Linux x64 universal**: `aura_<version>_amd64.AppImage` (atualização interna só funciona com AppImage)
- **Dependências Linux**: WebKitGTK 4.1 e libsecret

## Compilar do código

```bash
pnpm install
pnpm tauri dev
pnpm tauri build
```

## Configuração

Ajustes → Modelos: provedor, chave, catálogo e favoritos. Ajustes → Geral: caminhos permitidos, regras globais, espelho de skills. Ajustes → Aparência: tema, tamanho, Markdown ao vivo, horários de sessão. Ajustes → Segurança: eventos.

## Contribuir

Issues e pull requests são bem-vindos. Leia primeiro [CONTRIBUTING](../../CONTRIBUTING.md) e [CODE_OF_CONDUCT](../../CODE_OF_CONDUCT.md).

## Licença

[Apache License 2.0](../../LICENSE).
