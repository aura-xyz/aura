[简体中文](./README.md) | [English](./README-en.md) | [日本語](./README-ja.md) | [Español](./README-es.md) | **Português**

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

Agente de IA de desktop com prioridade local, construído com Tauri 2.0 + React 19 + TypeScript. Suporta vários provedores de modelos na nuvem e frameworks de inferência local; sessões, credenciais e configurações ficam todas na sua máquina.

## Funcionalidades

- **Múltiplos provedores**: 17 predefinições de provedores integradas (OpenRouter, OpenAI, DeepSeek, Moonshot Kimi, Zhipu GLM, MiniMax, SiliconFlow, 01.AI, Baichuan, StepFun, Groq, xAI, Together, Alibaba Bailian, Volcano Ark, Tencent Hunyuan, além de endpoints personalizados compatíveis com OpenAI). Ao escolher um provedor, o endereço oficial da API é preenchido automaticamente.
- **Modelos locais**: suporte a Ollama e llama.cpp server — verifique o status do serviço, baixe modelos e acompanhe o progresso do download dentro do app.
- **Catálogo e favoritos**: obtenha com um clique a lista completa de modelos de um provedor, pesquise e marque seus favoritos; os favoritos são agrupados por provedor e podem ser trocados a qualquer momento na página de conversa.
- **Três modos de trabalho**: Chat, Plan e Build, alternados pelas abas. O modo aplicado é o selecionado no momento de enviar cada mensagem.
- **Lista de tarefas**: o modo Plan produz passos executáveis exibidos na barra lateral; o modo Build os avança passo a passo com atualizações de status em tempo real.
- **Sessões com múltiplos workspaces**: a barra lateral organiza as sessões por espaço de trabalho —criar, alternar e excluir—; menu de contexto pelo botão direito e renomeação em linha (nenhum arquivo em disco é tocado). Após o envio da primeira mensagem, o espaço de trabalho fica bloqueado: cada conversa corresponde a exatamente um espaço de trabalho.
- **Fallback automático**: quando o modelo principal atinge o limite de requisições ou falha, o Aura alterna para o próximo modelo disponível da cadeia de reserva e informa o motivo.
- **Saída em streaming**: renderização incremental via SSE com efeito de máquina de escrever; a geração pode ser interrompida a qualquer momento.
- **Conjunto completo de ferramentas**: `list_files` / `read_file` / `search_workspace` para leitura e busca, `write_file` / `string_replace` / `replace_lines` para editar arquivos, `run_script` para executar comandos —com cartões de ação em tempo real, nova tentativa em caso de falha e avisos de diagnóstico.
- **Gestão de contexto**: o histórico é comprimido automaticamente ao se aproximar do limite de contexto, para que conversas longas não sejam interrompidas; a lista de tarefas é salva separadamente e sobrevive à compactação.
- **Lista de permissões de caminhos**: além da área de trabalho, você pode autorizar outros diretórios para o modelo ler e gravar (o diretório de habilidades, para ele manter as próprias). Diretórios do sistema e de chaves são **sempre recusados**; pastas como `Desktop` ou `Documents` perguntam antes.
- **Linha do tempo de operações**: a「Trilha」na barra lateral registra cada passo desta conversa: quais ferramentas foram chamadas, com quais argumentos, quanto demoraram e onde algo foi bloqueado. Isolada por conversa, com busca e exportável em Markdown.
- **Skills (habilidades)**: instruções reutilizáveis escritas como `SKILL.md` na área de trabalho ou na máquina. O modelo as carrega sob demanda, então as que não são carregadas não consomem contexto, e uma habilidade só pode restringir permissões — nunca contornar os limites do modo. A página Skills lista todas as habilidades com a origem (área de trabalho / local / mercado / integradas) e permite ativá-las, desativá-las ou excluí-las. O mercado instala com um clique, mas **inspeciona o pacote antes**: lista as permissões que a habilidade pede e quaisquer comandos perigosos ou linhas de injeção de prompt que ele contenha, e você decide. Também é possível adicionar qualquer repositório do GitHub como fonte extra, ou conectar uma biblioteca de habilidades de terceiros como o SkillHub (**filtrar por fonte e pesquisar dentro dela**).
- **Página de configurações**: barra lateral recolhível; as configurações cobrem aparência, serviços de modelo e opções gerais, com alternância de tema claro/escuro e regras globais.
- **Persistência local**: histórico de sessões, listas de tarefas e configurações ficam em um banco de dados SQLite local; as chaves de API são criptografadas em repouso com Windows DPAPI —nada depende da nuvem.

## Modos de trabalho

Escolha um modo pelas abas. **O modo aplicado é o selecionado no momento de enviar cada mensagem, e pode ser alterado a qualquer momento.** Os três modos diferem no alcance das ações permitidas e no foco do prompt:

| Modo | Finalidade | Ler arquivos | Modificar arquivos | Executar comandos | Foco |
| --- | --- | :---: | :---: | :---: | --- |
| Chat | Perguntas e respostas | ✓ | — | — | Responde diretamente, sem fluxo de trabalho |
| Plan | Produzir um plano | ✓ | — | — | Primeiro investiga o estado atual, depois dá passos executáveis |
| Build | Fazer o trabalho | ✓ | ✓ | ✓ | Avança a lista de tarefas passo a passo com progresso em tempo real |

As permissões são impostas pelo próprio programa: mesmo que o modelo tente chamar uma ferramenta de escrita no modo Chat ou Plan, a chamada é interceptada com um aviso para alternar para o modo Build —nunca falha em silêncio.

A lista de tarefas é limpa automaticamente quando todos os passos são concluídos, é salva junto com a sessão e é restaurada após reiniciar.

> **Avisos de mudanças de comportamento**
>
- v0.7.0 (em desenvolvimento, ainda não publicado):
  - As mensagens aceitam «regenerar» e «editar e reenviar»: ambos rebobinam o contexto antes de reenviar, então nada obsoleto fica para trás
  - Ao regenerar, a versão anterior é mantida e você pode alternar entre elas (alternar só muda a exibição; os turnos seguintes seguem com a versão mais recente)
  - Clique com o botão direito na área de mensagens para copiar uma resposta inteira; blocos de código ganham botão de cópia
  - Edições de arquivo podem ser abertas em uma visão de diferenças que marca as linhas adicionadas e removidas
  - Blocos de código com mais de 20 linhas começam recolhidos
  - Soltar um arquivo anexa o caminho à caixa de entrada; diretórios do sistema e de chaves são recusados, e os que exigem autorização são sinalizados
  - A janela pode ficar na bandeja do sistema e continuar em segundo plano, com notificação do sistema quando uma tarefa termina (só enquanto a janela não está em frente)
  - Ctrl+F abre a busca de sessões dentro do app
  - O estado vazio mostra cartões de exemplo que preenchem um prompt inicial na caixa de entrada
  - Fechar a janela agora a minimiza para a bandeja; use «Sair do Aura» na página sobre para sair de vez
  - As atualizações agora são baixadas de várias fontes e escolhem automaticamente a mais rápida (downloads do GitHub são muito lentos na China continental)
  - Digite `@` no campo para ver a lista de arquivos do espaço de trabalho (caminhos relativos funcionam: `@app` lista os arquivos e pastas dentro de app); digite `/` para ver a lista de habilidades ativas. Escolher uma insere no campo
  - A tela inicial agora é um bloco centralizado: ícone e título, depois o campo de entrada, depois os exemplos
> - v0.6.3:
>   - Renovação visual: novas cores semânticas de sucesso, aviso e marca, e todos os contrastes do modo escuro passam a atingir o padrão de acessibilidade 4.5:1.
>   - Suas mensagens usam um fundo azul da marca, para se destacar das respostas da IA; a sessão atual da barra lateral também recebe a marca.
>   - As linhas de ferramentas mostram um ponto colorido de resultado e o tempo decorrido, com um girador da marca durante a execução.
>   - Cópia com um clique para mensagens e blocos de código (aparece ao passar o mouse), com confirmação visível.
>   - O clique com o botão direito na área de mensagens deixou de ser um beco sem saída: copie uma mensagem inteira ou um bloco de código.
>   - Barras de rolagem mais finas: a interface não parece mais uma página web.
>   - A posição e o tamanho da janela são lembrados e restaurados ao reabrir o app.
>   - F5 / Ctrl+R são interceptados, sem mais tela branca piscando.
>   - Os rascunhos de entrada são mantidos por conversa, trocar de sessão não os perde; pressione Seta para Cima em uma caixa vazia para chamar sua última mensagem.
>   - Contagem de tokens ao vivo no canto inferior direito da caixa de entrada.
>   - A barra lateral ganha a entrada «Linha do tempo», e a seção de permissões de caminhos usa cores de aviso (as telas da v0.6.2 entram na mesma linguagem visual).
> - v0.6.2:
>   - Lista de permissões de caminhos: autoriza outros diretórios para o modelo ler e gravar. Diretórios do sistema e de chaves são recusados; pastas com dados pessoais exigem confirmação
>   - O mercado passa a aceitar várias fontes com filtro por fonte, e se conecta à biblioteca de terceiros SkillHub
>   - A instalação pelo mercado valida os nomes de ferramenta declarados: uma habilidade com erro não instala e você recebe o nome que está errado
>   - Nova linha do tempo de operações: registra cada passo de uma conversa, com busca e exportação em Markdown
>   - O seletor de área de trabalho foi para perto do seletor de modelo
> - v0.6.1:
>   - A página Skills está disponível: mostra a origem, a versão e as ferramentas permitidas de cada habilidade, e permite ativá-las, desativá-las ou excluí-las (as integradas e as da área de trabalho não podem ser excluídas).
>   - Novo mercado de habilidades: instale habilidades do registro oficial com um clique; cada pacote é verificado obrigatoriamente pelo seu sha256.
>   - Auditoria antes da instalação: mostra as permissões pedidas pela habilidade e os padrões de risco do pacote (comandos de exclusão, leitura de credenciais, injeção de prompt); achados de alto risco exigem uma segunda confirmação.
>   - Qualquer repositório do GitHub pode ser adicionado como fonte extra; habilidades instaladas podem ser atualizadas no local e os arquivos que você adicionou ao diretório da habilidade são preservados.
>   - Corrigida a falha constante de «verificar atualizações» (o manifesto de publicação estava malformado desde a v0.5.0 — não era um problema de rede).
> - v0.6.0:
>   - Após o envio da primeira mensagem em uma conversa, seu espaço de trabalho não pode mais ser alterado (cada conversa corresponde a exatamente um espaço de trabalho).
>   - Área de entrada redesenhada: o alternador de modos e o seletor de modelo passam a ficar dentro do cartão de entrada, com um layout mais compacto.
>   - O rótulo de linguagem dos blocos de código foi movido para o canto superior esquerdo; adicionado realce para ini (TOML), Dockerfile, PowerShell, nginx, protobuf e HTTP.
>   - As chaves de API agora são criptografadas em repouso (Windows DPAPI) em vez de armazenadas em texto puro; após trocar de usuário do Windows ou reinstalar o sistema, será necessário inseri-las novamente.
> - Desde v0.5.0: o modo Chat passou de acesso total para somente leitura. Após atualizar, alterne para o modo "Build" se quiser que o Aura modifique arquivos diretamente.
> - v0.5.2:
>   - Novas entradas no topo da barra lateral: "Nova conversa", "Skills" e "MCP"; as duas últimas são reservas para funcionalidades futuras.
>   - O recolhimento e a expansão da barra lateral agora usam uma animação de transição suave.
>   - O diretório de trabalho passa a ser escolhido ao criar uma nova conversa; não é possível enviar mensagens antes de escolher.
>   - Conversas no mesmo diretório são agrupadas automaticamente.
>   - Corrigido um problema em que a primeira mensagem após reiniciar podia ler o diretório do espaço de trabalho anterior.
> - v0.5.1:
>   - Corrigido o congelamento prolongado da interface ao executar comandos com muita saída (como instalar dependências ou compilar um projeto).
>   - Agora é possível emitir várias chamadas de ferramentas em um mesmo turno, executadas em ordem, sem precisar esperar cada resultado para continuar.
>   - Corrigido um erro de ordem em que os cartões de ação apareciam antes do texto principal quando o modelo "falava primeiro e chamava as ferramentas depois".
>   - Blocos de código exibem o rótulo de linguagem no canto superior direito.
>   - Corrigido um problema em que clicar em "Parar" após trocar de sessão interrompia a tarefa de outra sessão.
>   - Corrigidos dois estilos de aviso vermelhos que não tinham efeito.

## Provedores integrados

| Categoria | Provedores |
| --- | --- |
| Internacional | OpenRouter, OpenAI, DeepSeek, Moonshot Kimi, Groq, xAI Grok, Together AI |
| China | Zhipu GLM, SiliconFlow, 01.AI Yi, Baichuan, StepFun, MiniMax, Alibaba Bailian Qwen, Volcano Ark Doubao, Tencent Hunyuan |
| Local | Ollama, llama.cpp server |
| Outros | Azure OpenAI, endpoints personalizados compatíveis com OpenAI (suporta cabeçalhos de requisição personalizados) |

Todos os provedores de nuvem são acessados pelo protocolo compatível com OpenAI, com regras integradas para endpoints que não usam o caminho `/v1`, como DeepSeek, Zhipu GLM e Volcano Ark.

## Capturas de tela

### Página de boas-vindas

![Página de boas-vindas](assets/images/主页面——无对话.png)

### Conversa básica

![Conversa básica](assets/images/基础对话.png)

### Chamadas de ferramentas

![Chamada de ferramenta 1](assets/images/工具调用1.png)

![Chamada de ferramenta 2](assets/images/工具调用2.png)

## Desenvolvimento

```bash
pnpm install
pnpm tauri dev
```

Depuração apenas do frontend:

```bash
pnpm dev
```

## Compilação

```bash
pnpm tauri build
```

## Configuração

Configure na seção "Serviços de modelo" da página de configurações —um cartão por provedor—:

1. Escolha o provedor de modelos (o endereço oficial da API é preenchido automaticamente)
2. Preencha a chave de API desse provedor
3. Clique em "Obter lista de modelos" para buscar os modelos disponíveis, depois pesquise e marque os que deseja manter

As chaves são salvas apenas no banco de dados SQLite local e são criptografadas com Windows DPAPI (vinculadas ao usuário atual do Windows); nunca são enviadas para serviços de terceiros. Após trocar de usuário do Windows ou reinstalar o sistema, será necessário inserir novamente a chave de cada provedor.

Modelos locais (Ollama / llama.cpp) não precisam de chave de API —basta garantir que o serviço local esteja iniciado.

> **Sobre variáveis de ambiente**: `OPENROUTER_API_KEY` é mantido apenas como reserva de compatibilidade histórica para o OpenRouter; insira as chaves dos outros provedores na página de configurações.

## Stack tecnológico

- [Tauri 2.0](https://tauri.app) — backend Rust, janela e IPC
- React 19 + TypeScript + Vite — frontend
- Tailwind CSS v4 — estilos (tokens do Pinguo Design System)
- rusqlite — armazenamento local
- reqwest — acesso HTTP multiprovedor

## Licença

Este projeto é de código aberto sob a [Apache License 2.0](LICENSE).
