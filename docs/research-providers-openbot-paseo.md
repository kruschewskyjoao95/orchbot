# Pesquisa — Provedores de IA no OpenBot e no Paseo

> Como `nightly-labs/openbot` e `getpaseo/paseo` implementam provedores de IA para
> orquestração de agentes, lido de fontes primárias (código-fonte no GitHub, branch
> `main`, consultado em 2026-11-02). Cada afirmação cita o arquivo/caminho no repositório
> de origem. No fim: o que um app Electron + SolidJS local-first (o Orchbot) deveria copiar
> e as lacunas prováveis em relação aos dois.
>
> Convenção de citação: `repo: caminho/no/repo`. Ex.: `openbot: docs/architecture/providers.md`.

---

## 0. Resumo executivo

| Aspecto | OpenBot | Paseo |
|---|---|---|
| Filosofia do runtime | **Baixa e gerencia as CLIs** (download verificado por hash, atualização horária) | **Usa a CLI que o usuário já instalou** e autenticou |
| Provedores embutidos | 15 ids fechados em contrato | 6 core + 2 plugins + catálogo ACP aberto |
| Extensibilidade | Endpoint OpenAI-compatible + agente ACP customizado + registro ACP | `extends` em `config.json` (derivar de qualquer built-in ou de `acp`) + plugin SDK |
| Protocolo dominante | ACP para 8 de 15; diretos: Codex app-server, Claude SDK, Grok, Pi RPC, Muse MSP | ACP recomendado p/ novos; diretos: Claude, Codex, OpenCode, Pi, OMP |
| Cadastro de provider | UI rica em Settings (SolidJS) + contratos IPC tipados | Arquivo `~/.paseo/config.json` + tela Settings → Providers (React Native) |
| Catálogo de modelos | Descoberto via `model/list` do CLI em execução, com fallback estático | Descoberto via `fetchCatalog`; Claude tem manifest estático curado |
| Segredos | `safeStorage` (Electron), chave nunca volta ao renderer | Texto no `config.json` / env do processo; chave nunca cruza a wire p/ o app |

A diferença mais importante para copiar: **o OpenBot trata a CLI como artefato
gerenciado** (pin + hash + update + remoção), enquanto **o Paseo trata a CLI como
pré-requisito do usuário** e investe em vez disso num sistema de *overrides*
(`extends`/`command`/`env`/`models`) e num catálogo ACP instalável em um clique.
Os dois convergem em: ACP como protocolo de extensão, descoberta dinâmica de
modelos/modos, status em três estados (instalado/autenticado/faltando) e troca de
modelo sem recriar a conversa.

---

## 1. OpenBot (`nightly-labs/openbot`)

Stack confirmada em `openbot: package.json`: Electron + SolidJS (`solid-js`,
`electron-vite`, `electron-builder`), Bun como runtime de scripts, TypeScript.
É o referencial mais próximo do Orchbot.

### 1.1 Lista de provedores suportados

A lista é **fechada e única**: `AGENT_PROVIDERS` em
`openbot: packages/contracts/src/agent-providers.ts:23-39`:

```ts
export const AGENT_PROVIDERS = [
  "codex", "claude", "grok", "opencode", "antigravity", "cursor", "cline",
  "pi", "muse", "inception", "deepseek", "openrouter", "hermes", "acp", "kimi",
] as const;
```

O comentário no topo do arquivo (linhas 7-21) explica o porquê: antes o provider era
"escrito à mão umas vinte vezes" (cinco cadeias literais, quatro listas no renderer,
um destructure no preload que lançava erro em id desconhecido). Agora **adicionar um
provider = uma linha nessa tabela + um driver** em `src/backend/provider-drivers.ts`.
O truque de cobertura é `satisfies Record<AgentProviderId, …>`: um id novo sem linha
no descritor vira erro `TS2741` antes de qualquer teste.

Mapa provider → CLI → transporte (de `AGENT_PROVIDER_DESCRIPTOR_TABLE` no mesmo
arquivo e de `openbot: docs/architecture/providers.md`):

| id | Nome exibido (`displayName`) | CLI (`cliName`) | Transporte | `defaultModel` |
|---|---|---|---|---|
| `claude` | Claude | Claude Code | Direto (Claude Agent SDK) | `claude-haiku-5-5` |
| `codex` | ChatGPT | Codex CLI | Direto (Codex app-server, JSON-RPC) | `gpt-6-luna` |
| `grok` | Grok | Grok CLI | Direto (`GrokAgentClient`, ACP `x.ai/interject` p/ steer) | `grok-4.6` |
| `opencode` | OpenCode | OpenCode CLI | ACP (`opencode acp`) | `""` (1º do catálogo) |
| `antigravity` | Gemini | Antigravity ACP server (`agy_acp_server`) | ACP | `""` |
| `cursor` | Cursor | Cursor CLI (`cursor-agent acp`) | ACP | `""` |
| `cline` | Cline | Cline CLI (`cline --acp`) | ACP | `""` |
| `kimi` | Kimi | Kimi Code CLI (`kimi acp`) | ACP | `""` |
| `pi` | Pi | Pi CLI | Direto (`pi --mode rpc`, **não** ACP) | `""` |
| `muse` | Muse | Muse CLI | Direto (`@muse-code/sdk`, `muse serve` via MSP) | `""` |
| `inception` | Inception | Pi CLI (`cliProvider: "pi"`) | Direto via Pi + extensão de chave | `mercury-3` |
| `deepseek` | DeepSeek | Pi CLI (`cliProvider: "pi"`) | Direto via Pi + extensão de chave | `deepseek-v4-pro` |
| `openrouter` | OpenRouter | Pi CLI (`cliProvider: "pi"`) | Direto via Pi + extensão de chave | `anthropic/claude-sonnet-5.5` |
| `hermes` | Hermes | Hermes Agent (`hermes acp`) | ACP, **sem runtime gerenciado** | — |
| `acp` | Custom agent | qualquer programa ACP salvo pelo usuário | ACP genérico | `<agentId>/default` |

Detalhes que importam:

- **Gemini ≠ Gemini CLI.** O id é `antigravity` com `displayName: "Gemini"`, porque
  "o Google migrou contas Google AI Pro/Ultra do Gemini CLI para o Antigravity em
  18 jun 2026" (comentário em `agent-providers.ts:290-291`). O binário é o servidor
  ACP do Antigravity (`agy_acp_server`), baixado sob demanda — a licença do Google
  não permite redistribuição (`providers.md`, seção *Gemini*).
- **Inception/DeepSeek/OpenRouter são "key-only providers"**: não têm CLI própria,
  rodam sobre o Pi gerenciado (`cliProvider: "pi"` em `provider-drivers.ts:664-690`;
  `KEY_ONLY_PROVIDERS` em `agent-providers.ts:655`). A chave é a única forma de
  login; Connect/Reconnect abre o diálogo de chave. O Pi registra o provider via
  extensão gerada (`src/backend/pi-key-providers.ts`, `pi.registerProvider(...)`),
  com a chave no ambiente do processo e num slot `globalThis` — nunca escrita na
  fonte da extensão.
- **Hermes é o único sem download gerenciado**: "uma versão mais nova do Hermes move
  `state.db`/`config.yaml` em `~/.hermes` para frente, e o Hermes antigo do usuário
  não lê mais" (`providers.md`, seção *Hermes*). Usa-se o `hermes` do usuário.
- **Fora da lista**: não há `copilot` nem `gemini-cli` como provedores nativos.
  Copilot/Gemini CLI só entram como **agente ACP customizado** (seção 1.5) ou pelo
  registro ACP. Também não há provider "genérico OpenAI" — endpoint customizado é
  servido por OpenCode ou Pi (seção 1.3).

Cada descritor carrega muito mais que nome — é o "contrato de produto" do provider
(`AgentProviderDescriptor`, `agent-providers.ts:85-189`): `cliName`,
`onboardingDescription` (a linha sob o nome em Settings/onboarding), `signInMessage`,
`installGuideLink` (`null` = "OpenBot entrega a CLI, não há para onde ir"),
`legacyModelPrefix` (p/ importar `bots.json` antigo), `authKind`, `pickerOrder`,
`localCodeSignIn` (`"device" | "paste" | null`), `signInPageEnd`
(`"callback" | "page"`), `skillFolders`, `homeSkills`
(`native|plugin|instructions`), `workspaceInstructionFiles`, `workspaceEnforcement`
(`tool-sandbox|command-sandbox|confined-process`), `steer` (`native|deferred`),
`concurrentTurns`, `reportsUsage`, `approvalsInFullAccess`, `foldersInFullAccess`.

### 1.2 Detecção e instalação da CLI

Três camadas, nesta ordem (`providers.md`, seção *Provider CLI updates*):

1. **Explícito**: `OPENBOT_<PROVIDER>_PATH` no ambiente (ex.:
   `OPENBOT_ANTIGRAVITY_PATH=.../bin/agy_acp_server.par`). Um caminho explícito
   **suprime ofertas de update gerenciado** — "aquele caminho nomeia o binário a rodar".
2. **Cópia gerenciada**: baixada em `appData/OpenBot/provider-runtimes` (um store por
   computador, não por perfil — decisão documentada: store dentro de `userData`
   começava vazio em cada perfil de dev e baixava tudo de novo).
3. **CLI do sistema**: descoberta no `PATH` do *login shell*.

Regras de resolução que valem copiar:

- `resolveInstalledFirst` (`src/backend/cli.ts`): se a cópia do sistema tem versão
  **igual ou maior**, ela vence a gerenciada. Versão incomparável (ex.: dois builds
  Cursor da mesma data) mantém a gerenciada. Antigravity **nunca** é procurado no
  `PATH` — o editor Antigravity instala um comando `antigravity` que não é o servidor.
- Descoberta no macOS/Linux: `loginSearchPath` roda `printf %s "$PATH"` no shell de
  login (`$SHELL` se for POSIX conhecido ou fish; senão `/bin/zsh` no macOS), com
  cache de 60 s, e depois pastas fixas: `~/.local/bin`, `~/.npm-global/bin`,
  `~/.volta/bin`, `~/.bun/bin`, pnpm home, Homebrew, pastas do sistema. **nvm é
  deliberadamente ignorado** ("só o setup de shell do nvm escolhe a versão").
- Cada processo lançado usa o `launchPath` resolvido (pastas do login shell, depois
  as do OpenBot, depois a pasta da CLI) — é o que permite a um app aberto pelo Finder
  rodar uma CLI `#!/usr/bin/env node`.
- Versão mínima recusada: `resolveClineCli` recusa Cline < 3.0.68;
  `resolveKimiCli` recusa Kimi < 1.52.0 (`providers.md`, seções *Cline*/*Kimi*).

**Instalação gerenciada** (`native-runtime.lock.json` + `provider-runtime-manager.ts`
+ `provider-runtime-releases.ts`):

- O lock fixa versão e artefato **por plataforma** (`darwin-arm64`, `darwin-x64`,
  `linux-arm64`, `linux-x64`, `win32-x64`), com `assetSha256`, tamanhos e executável
  (ex.: Codex 0.160.1, `codex-package-<triple>.tar.gz`, ~130–160 MB por plataforma).
- Fonte do "mais novo": GitHub `releases/latest` (Codex, Pi, Kimi), tag `latest` do
  npm (Claude, OpenCode, Cline), `x.ai/cli/stable` (Grok), canal `muse-stable`
  (Muse), registro ACP (Antigravity/Gemini, Cursor). Checagem na abertura, a cada
  hora e em *Check for updates*.
- **Verificação de integridade sempre que a fonte publica hash**: `digest` do asset
  no GitHub, `checksum` do manifest (Muse), `dist.integrity` do npm. xAI e o
  registro ACP não publicam hash → "confiado só no TLS" (declarado abertamente).
  Gemini ainda exige host `dl.google.com/agy-extensions/releases` e nome de comando
  fixado; Cursor exige path `downloads.cursor.com/lab` e build começando com a data
  do registro.
- Cada instalação grava `openbot-install.json` com o SHA-256 de cada arquivo; **toda
  abertura reverifica** o registro e o `--version`. "A versão mais nova do store que
  verifica é a que roda."
- `provider-runtime-blocklist.json` na branch `main` barra uma versão quebrada do
  upstream sem precisar de release do OpenBot (só suprime a oferta; não remove o
  instalado).
- Canary de 6 em 6 h (`.github/workflows/provider-cli-canary.yml`) instala o
  OpenCode mais novo e roda casos de conformidade com o modelo gratuito
  `opencode/big-pickle`, sem conta; duas falhas seguidas abrem uma issue, um passe
  fecha.
- Update **não interrompe turno**: se o provider está em turno, a atualização espera
  (estado `downloading` sem progresso, mensagem `status.provider.updateWaiting`,
  cancelável); agentes daquele provider não iniciam turno até o novo cliente estar
  pronto (`isReplacingCli`). Falha de ativação remove o artefato rejeitado e mantém
  o CLI anterior funcionando.
- Após upgrade do app, os CLIs gerenciados são atualizados sem oferta
  (`openbot-provider-cli-app-version-v1.json` guarda a última versão do app que
  checou; #3164).
- Remoção: Settings → provider → **Remove download** (#3321) apaga todas as versões
  daquele CLI; recusado se o provider está ligado, baixando, ou tem path explícito.
  Contas e logins não são tocados. Server settings → Storage tem a linha agregada
  "Provider runtimes" (`removableRuntimes`/`removeRemovableRuntimes`).
- Coleta de versões antigas por *stamp* de uso (janela de 2 dias; 3 h após 1 h de
  máquina acordada) — detalhe de implementação denso em `providers.md`; a ideia
  copiável é: **nunca apagar a versão que outra instância pode estar rodando**.

`MANAGED_RUNTIME_PROVIDERS` (`agent-providers.ts:609-620`): `codex, claude, grok,
opencode, antigravity, cursor, cline, kimi, pi, muse` — 10 dos 15 têm download
gerenciado; `hermes` e `acp` não; os key-only reusam o Pi.

### 1.3 Cadastro/configuração de provider (UI de Settings)

A tela é `openbot: packages/ui/src/features/settings/ProviderSettingsPage.tsx`
(SolidJS, ~1900 linhas). Estrutura observada:

- **Lista de providers** com busca, separada em *conectados* e *outros*
  (`connectedRows`/`otherRows`). Cada linha: logo (`packages/brand/src/ProviderLogo.tsx`),
  nome, status e ação de abrir a página do provider.
- **Página por provider** com cabeçalho de status (`IntegrationStatus`:
  `connected | connecting | attention | idle | unavailable`) e seções:
  - **Contas**: lista de contas (`ProviderAccountList.tsx`), com menu `⋯` por conta —
    *Reset usage* (quando há crédito, só Codex), *Disconnect* (só a conta "própria";
    Claude/Codex via `auth logout`, Grok/Muse/Cursor via driver `signOut`; Cline,
    Gemini e Pi não têm sign-out — `providers.md`, *Disconnect the own sign-in*).
  - **API key** (quando aplicável): seção própria que abre o diálogo de chave.
    Status da chave é só `missing | saved | unreadable`
    (`ProviderApiKeyStatus` em `ipc-provider-admin.ts`; `decodeProviderApiKeyStatus`).
    A chave **nunca volta ao renderer**: main guarda em
    `src/main/provider-credential-store.ts`, criptografada com `safeStorage` do
    Electron, envelope `0o600`; só o status cruza o IPC, nenhum getter devolve a chave.
  - **Versão**: linha "Version" que distingue *"instalada pelo usuário"* de
    *"baixada pelo OpenBot"* (`VERSION_SOURCE: { system, managed }`), mostra
    `availableVersion` quando há update e o botão Update. Fases do runtime:
    `not-downloaded | downloading | finishing | ready | download-error`
    (`ProviderRuntimeStatus` em `ipc-provider-admin.ts`).
  - **Download**: medir/remover o download (bytes e nº de versões).
  - **Liga/desliga por computador**: interruptor que grava
    `openbot-provider-use-v1.json` (`ProviderUseSettingsStore`). Provider desligado
    não roda CLI, não descobre modelo e recusa connect/sign-in explícito; ligar
    re-checa na hora. Recusado desligar enquanto um agente usa o provider
    (trava de atribuição de modelo em `AgentService`).
- **Provider padrão**: `DefaultProviderRow` — o provider/modelo com que um agente
  novo nasce.
- **Backup models / failover** (configurado no agente, exibido em settings):
  lista ordenada de até 8 modelos (`AgentBackupModels`). Em limite de uso ou erro
  de provider (billing, indisponível, rate limit, auth, rede, timeout) **antes de
  qualquer trabalho do turno**, a mensagem volta à fila e roda no backup, com hold
  de 10 min no modelo que falhou (`providers.md`, *Backup models and failover*).
- **Ícone de configuração**: não há um "ícone de engrenagem por provider" isolado;
  o padrão é linha clicável na lista de Settings → página dedicada, com menu `⋯`
  por conta para ações raras (Reset usage, Disconnect). Diálogos dedicados:
  `ProviderCodeLoginDialog` (colar código), `ProviderUseAppDialog`,
  `MoreProvidersDialog`, `ProviderSignInDialogs.tsx` (renderer).

**Login / auth — quatro famílias** (`ProviderSignIn` em `provider-drivers.ts:157-196`):

| `kind` | Como loga | Quem |
|---|---|---|
| `browser` | CLI abre o navegador (device/browser flow) | Codex (`codex-device`) |
| `cli-command` | Comando do CLI aguardado até sair (`auth login`, `login`) | Claude (`claude auth login --claudeai`), Grok, Kimi (`kimi login`), Cursor |
| `acp-authenticate` | Chamada ACP `authenticate` em processo separado (`acp-sign-in.ts`) | Gemini (`oauth-personal`), Cursor (`cursor_login`), Cline (`cline`) |
| `terminal` / `external` / `muse-device` | Usuário loga fora (terminal do host) e o OpenBot só observa | Pi (`/login` no Pi do host), Hermes (`hermes auth add nous --type oauth`), Muse (device via `muse serve`) |

Mais: **code sign-in** (`codeSignIn`) para quando o callback do navegador não alcança
o OpenBot — device code colável (`ProviderCodeLoginDialog`), com `userCode`,
`verificationUrl`, `verificationUrlComplete`, `expiresAt`
(`decodeProviderCodeLoginStart` em `ipc-provider-admin.ts`). E **sign-in relay**
para servidor remoto: `provider-account-relay-v2` / `provider-host-sign-in-v1`
(Team API) abrem a página de login no navegador do *host* via live view; nenhuma
rota carrega link nem credencial.

Detecção de "logou fora do OpenBot": cada driver pode declarar `signInFiles()`
(arquivos que o CLI escreve ao logar); um watcher re-checa a conta quando mudam —
login feito por SSH/terminal aparece sem reiniciar.

**Status do provider** (`AgentProviderStatus`, montado em
`src/backend/agent/provider-status.ts`): estados incluem `available`,
`sign-in-required`, `not-installed`, `outdated`, `error`, `connecting` — com
`version` e `message` **redigida** (`redactText`, porque "uma falha do OpenCode pode
carregar a API key ou um header de endpoint customizado"). Timeout de CLI **não**
é "quebrado": a mensagem não pede reinstalação. CLI desatualizada vira `outdated`
com caminho de update, não erro genérico.

**Teste de conexão**: não há um botão "Test" isolado por provider; o equivalente é
triplo — (a) a checagem de conta (`account/read` / descoberta de modelos via
`session/new`) que move a linha para Connected; (b) *Check* de agente ACP
customizado (seção 1.5); (c) *Discover models* de endpoint customizado (seção 1.4).
O diagnóstico contínuo vive em `packages/ui/src/features/provider-diagnostics/`.

### 1.4 Endpoint customizado OpenAI-compatible ("Custom provider")

Contrato em `openbot: packages/contracts/src/ipc-custom-providers.ts`. Um custom
provider **não é um `AgentProviderId` novo**: é um endpoint servido por um *harness*
— OpenCode (padrão) ou Pi (`CUSTOM_PROVIDER_HARNESSES = ["opencode", "pi"]`).
A identidade na wire continua `opencode`/`pi`; o modelo aparece como
`<providerId>/<modelId>` (ex.: `studio-local/qwen3-coder:30b`).

Campos do formulário (`CustomProviderDialog.tsx` +
`custom-providers/custom-provider-form.ts`, tipo `CustomProviderDraft`):

- `providerId` — `^[a-z0-9][a-z0-9_-]*$`, não pode ser nome de built-in nem de um
  endpoint já salvo (sem sobrescrita: apagar e recriar para trocar a chave).
- `displayName`
- `baseUrl` — obrigatória, `http:` ou `https:` apenas (http é "o caso principal":
  servidor local sem certificado), **sem credencial embutida na URL** ("seria
  guardada e listada em texto puro; a chave tem lugar próprio"), máx. 2048 chars.
- `apiKey` — opcional; `null` = "endpoint sem chave" (não é "" — um `apiKey` vazio
  no config do OpenCode viraria header `Authorization` vazio). Máx. 4096.
- `models[]` — linhas repetíveis: `id`, `name`, `contextWindow` (1024–100 000 000),
  `maxOutput` (256–1 000 000; exige `contextWindow`, senão é ignorado pelo backend).
  Até 64 modelos. Aceita `128,000`, `128 000`, `128.000`; recusa decimal.
- `headers[]` — até 32 headers nome/valor (nome validado como token RFC 9110).
- `harness` — OpenCode ou Pi, com estado de download do harness no próprio diálogo.

Segredos: a chave e os valores de header ficam **só no main**
(`src/main/custom-provider-store.ts`, ciphertext `safeStorage`); o renderer recebe
`CustomProviderSummary { id, name, baseUrl, hasApiKey, headerNames?, models, harness? }`.
O guard `isCustomProviderSummary` **rejeita qualquer registro que contenha a chave
`apiKey` ou `headers`** — "a renderer nunca vê a chave" é fato verificado na
fronteira, não hábito. Na edição, campo em branco = manter o guardado; trocar a
`baseUrl` para outra origem com chave mantida é recusado.

**Descoberta de modelos do endpoint**: botão no diálogo chama
`customProviders.discoverModels` → main faz `GET {baseUrl}/models` (timeout 8 s,
`DISCOVER_TIMEOUT_MS` em `src/main/provider-detection.ts`). A chave guardada só é
usada se o campo estiver em branco **e a origem for a mesma**
(`sameCustomProviderOrigin`: scheme+host+porta, com loopback `[::1]` ≠ `127.0.0.1`).
Modelos achados viram linhas marcáveis da mesma lista digitável — uma única fonte
na submissão. Salvar pode exigir restart do processo OpenCode (`restart:
restarted | skipped-busy | not-running`); com turno em andamento, não força.

**Presets** (`custom-provider-presets.ts`): `ollama`, `lmstudio`,
`openai-compatible`, `acp`. Preset só pré-preenche o formulário.

**Detecção local automática** (`src/main/provider-detection.ts` +
`ipc-provider-detection.ts`): varredura que **nunca envia chave**:

- Servidores: `DEFAULT_MODEL_SERVERS` = Ollama `http://127.0.0.1:11434/v1` e
  LM Studio `http://127.0.0.1:1234/v1`, mais endereços extras das settings
  (até 16). Probe `GET /models` com timeout de 1,5 s, concorrência ilimitada.
  Id sugerido: o conhecido (`ollama`) ou `server-<host>-<porta>` com sufixo `-2`, `-3`…
- Agentes ACP: `scanAcpAgents` procura comandos conhecidos no `PATH` do login shell
  e em pastas extras — **sem executar arquivo nenhum**.
- Settings de detecção (`ProviderDetectionSettings`): `enabled`, `addresses[]`,
  `folders[]`, `hiddenIds[]` (o usuário pode ocultar achados; chave
  `models:<endpoint>` ou `agent:<caminho>`). Linhas achadas e já salvas oferecem
  *Edit* em vez de *Add*.
- Tudo local: `providerDetection` e a edição de endpoint **não** são expostos a
  peers do Team API (um host conectado não recebe detecção nem Edit).

### 1.5 Agente ACP customizado e registro ACP

Formulário (`CustomAcpAgentDialog.tsx`, `custom-acp-agent-form.ts`): `displayName`,
`agentId` (`CUSTOM_AGENT_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,39}$/`, sem `_`),
`command` (caminho absoluto resolvido na varredura), `args`, `env[]` (nome/valor;
valores em ciphertext único `safeStorage` em `custom-agents.json`, nomes em texto
puro; só o backend lê os valores), `usagePrompt` opcional (ex.: `/usage`).

- **Check** (`customAgents.check`): sobe o programa numa pasta temporária, envia
  `initialize`, abre **um** `session/new` sem MCP servers para ler os nomes de
  modelo e mata o grupo de processos. `session/new` falhando (agente que exige
  login antes) **não** falha o check — só devolve zero modelos.
- **Registro ACP**: *Settings → ACP registry* (`AcpRegistrySettings.tsx`) consome
  `https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json`.
  Instalações nativas/npm usam staging + integridade publicada; entrada `uvx`
  exige `uvx` no host. Check de `initialize` antes de ativar; falha/cancelamento
  mantém o comando anterior. Remover apaga só arquivos gerenciados — mantém ids,
  settings, segredos, workspaces e conversas salvos do agente.
- Runtime: um `AcpAgentClient` por (agente, pasta) — "Command Code recusa sessão
  numa segunda pasta"; id de sessão prefixado `<agentId>:<tagDaPasta>:`. Processo
  de listagem de modelos é separado, em pasta temporária privada, para a sessão de
  probe nunca abrir num processo que serve uma thread.

### 1.6 Catálogo de modelos e troca mid-chat

`ModelCatalog.refresh` (`src/backend/agent/model-catalog.ts`) é deliberadamente
**sem branch de provider**: lê `model/list` (paginação `limit: 100, cursor`) de
cada CLI **em execução**, do mesmo jeito para todos. A exceção mora no driver
(`catalog` em `provider-drivers.ts`):

- Codex: pagina a lista e reporta o tier *Fast* (`serviceTiers`/`additionalSpeedTiers`).
- Claude: nomeia os próprios modelos (`claudeModelName` reconstrói "Claude Haiku 4.5"
  de `claude-haiku-4-5-20251001`, porque o CLI lista por papel — "Default
  (recommended)", "Opus" — e não por modelo).
- OpenCode: descarta modelos que a chave guardada não compra (Zen pago fora; Go e
  free dentro — `isOpencodeModelUnusableWithStoredKey`) e mantém o tier free se a
  descoberta falhar.
- Agente customizado: timeout de requisição completo (`slowList`).

Fallback estático (`FALLBACK_MODELS` + `OPENCODE_FREE_MODEL_FALLBACKS` em
`provider-models.ts`): 5 modelos Codex (`gpt-6-luna` … `gpt-5.6-sol`), 5 Claude,
8 OpenCode free (`opencode/big-pickle` etc.). Servem para o picker não nascer
vazio; **não** são prova do que o processo serve — refresh falho mantém o catálogo
anterior e marca o provider como "não fresco", e modelo fallback de provider
deslogado é escondido (`hiddenWhenSignedOut`).

Cada modelo carrega `supportedReasoningEfforts` e `defaultReasoningEffort` vindos
do CLI (`low|medium|high|xhigh|max|ultra`), com fallback p/ `["medium"]`. Ordenação:
tier primeiro (free → próprios pagos → terceiros), versão mais nova primeiro,
estável no empate (`PREFERRED_MODEL_ORDER`, `compareModelVersions`). Id inválido
pelo contrato é descartado **sozinho** — "o Cursor uma vez adicionou `=` e `,` e
isso esvaziou o picker de todos os providers" (por isso Team API v6 ampliou o
charset de modelo).

**Troca mid-chat**: trocar provider mantém agente, thread, workspace e mensagens —
só a sessão nativa muda, com *handoff* de até 32 000 caracteres (24k recentes +
4k trechos antigos + 2k passos de trabalho + 2k instruções) injetado na nova sessão
(`providers.md`, *History retrieval and replacement sessions*). Troca de
modelo/esforço no Claude usa setters vivos do SDK na próxima volta, **sem**
reiniciar a query nem substituir a sessão. `history_search`/`history_read`
recuperam texto omitido do handoff sem chamada de modelo.

### 1.7 Execução: spawn, streaming, sessão, interrupção

Fronteira única: `AgentClient` (um por provider). Transportes:

- **ACP** (`src/backend/acp-connection.ts` transporte, `acp-configuration.ts`
  config/descoberta, `src/backend/acp-client.ts` sessão/stream/permissões/cancel):
  JSON-RPC sobre stdio. Fluxo `initialize` (com `clientInfo` customizável por
  *flavor*) → `authenticate` opcional → `session/new` | `session/load` |
  `session/resume` → `session/prompt` com updates em streaming → `session/cancel`
  (notificação, não espera resposta). Permissões via `session/request_permission`,
  mas **quem decide é o nível de Permissões do agente no OpenBot**, não o ACP.
  Cada provider ACP tem um `AcpFlavor` (`acp-flavor.ts`, `acp-flavor-antigravity.ts`,
  `acp-flavor-opencode.ts`) com quirks: códigos de "sessão perdida" diferentes
  (OpenCode `-32602`, Cline `-32002`, Kimi `-32602` com `data.session_id`),
  `clientInfo.name: "zed"` p/ Antigravity liberar modelos Claude/GPT, retry de
  `session/resume` após 2 s no OpenCode 2, etc.
- **Codex direto**: app-server do Codex (`CodexAppServerClient`), `model/list`,
  `account/rateLimits/read`, `thread/*`, `turn/*`. Uso e *reset credits* vêm do
  app-server (`account/rateLimitResetCredit/consume` com `idempotencyKey` nova
  por reset).
- **Claude direto**: Claude Agent SDK (`ClaudeAgentClient`), MCP server construído
  das mesmas definições de ferramenta visíveis; compactação nativa do Claude.
- **Grok direto**: `GrokAgentClient` + hooks de login/billing xAI em
  `grok-client.ts`; steer nativo via extensão ACP `x.ai/interject`.
- **Pi direto**: `--mode rpc` com ids de requisição; `agent_settled` encerra o
  turno (a resposta de `prompt` só confirma aceite). Cancelamento limpa a fila
  antes do abort. MCP via extensão que usa `pi.registerMcpServer`; segredos por
  estado do processo, nunca na fonte da extensão.
- **Muse direto**: `@muse-code/sdk` 1.4.2 fixado, `muse serve` sobre MSP, uma
  sessão por host; `account/read` experimental num host efêmero separado para não
  contaminar os decoders estritos da sessão.

Sessão persistente: ids nativos guardados em `projection_provider_sessions`
(SQLite; migrations 17–28 foram alargando o `CHECK` de provider até a 28 removê-lo
— "um provider novo não precisa de migration"). Resume falho mantém a sessão
disponível p/ nova tentativa; sessão perdida ACP vira handoff p/ sessão nova.
Interrupção: ACP `session/cancel` + fim local imediato do turno + tool calls
abertas salvas como interrompidas; próxima mensagem faz `session/resume` com o
mesmo id. Steer (mensagem durante o turno): `native` só em Codex, Claude, Grok,
Pi e Muse (e nos key-only via Pi); ACP puro é `deferred` — a mensagem espera o
turno acabar (`steer` no descritor).

Compactação é do provider: Codex/Muse por eventos de turno, Pi pela resposta,
Claude nativa, ACP sem operação exposta. Antigravity só reporta preenchimento →
modo `handoff`: `ThreadLifecycle.rotateProviderSession` salva os passos, fecha e
abre sessão nova na mesma thread pública com handoff de histórico.

Ambiente de spawn: env lido **a cada spawn** (`extraEnv`), o que faz uma chave
salva em Settings valer no próximo processo sem plumbing. OpenCode recebe
`OPENCODE_DISABLE_AUTOUPDATE=1` (p/ não passar do pin), Cline recebe
`CLINE_SESSION_BACKEND_MODE=local` + `CLINE_NO_AUTO_UPDATE=1`, Kimi
`KIMI_CLI_NO_AUTO_UPDATE=1`, Cursor `CURSOR_CONFIG_DIR` confinado. Confinamento
de processo (`confined-process`) com `statePaths` por provider (o que pode
escrever × o que fica protegido em `~/.cursor`, `~/.cline`, `~/.kimi`,
`~/.gemini/antigravity-acp`…).

Uso/quotas: leitura espaçada por `UsageReadGate` (1 leitura por provider/conta
por vez, cache de 4 min, backoff 5→10→20→40→60 min após falha) — "o endpoint de
uso do Claude é compartilhado com o Claude Code e responde 429 por uma hora se
perguntarem demais". Referências declaradas: t3code e openusage.

---

## 2. Paseo (`getpaseo/paseo`)

Monorepo TypeScript: daemon Node (`packages/server`), app React Native/Expo
(`packages/app`, desktop + mobile + web), CLI (`packages/cli`), protocolo
compartilhado (`packages/protocol`), plugins (`plugins/`). Documentação de
provedores em `paseo: docs/providers.md` (guia de contribuição),
`paseo: docs/custom-providers.md` (configuração do usuário),
`paseo: public-docs/providers.md` e `public-docs/supported-providers.md`
(voltadas ao usuário).

### 2.1 Lista de provedores suportados

Três camadas (`public-docs/providers.md`, *Two tiers*):

**a) Nativos (adapter embutido, "auto-descoberto quando a CLI está instalada")** —
`AGENT_PROVIDER_DEFINITIONS` em `paseo: packages/protocol/src/provider-manifest.ts`:

| id | Label | Transporte | Modos (manifest) |
|---|---|---|---|
| `claude` | Claude | Direto (Claude Agent SDK, `providers/claude/agent.ts`) | plan, default (Always Ask), acceptEdits, auto, bypassPermissions |
| `codex` | Codex | Direto (app-server, `codex-app-server-agent.ts`) | auto, auto-review, full-access |
| `copilot` | Copilot | ACP (`copilot --acp`, `copilot-acp-agent.ts`) — **único ACP embutido "de fábrica"** além dos shims | URI modes do ACP + allow-all |
| `opencode` | OpenCode | Direto (runtime próprio v1/v2, `opencode-agent.ts`) | build, plan |
| `pi` | Pi | Direto (`pi --mode rpc`) | — (sem modos estáticos) |
| `omp` | Oh My Pi | Direto (`omp --mode rpc-ui`) — **desligado por padrão** (`enabledByDefault: false`) | full, write, ask |

**b) Plugins embutidos** (`plugins/<id>/`, via `@getpaseo/plugin/server/provider`,
sem entrada no manifest nem factory no core — `docs/providers.md`, *Plugin providers*):

| Provider | Transporte | Nota |
|---|---|---|
| Antigravity | CLI `agy` instalada | Só modo full-access (`--dangerously-skip-permissions`); sem steer nem MCP do Paseo |
| Muse Code | MSP sobre um `muse serve` por sessão | Igual ao OpenBot: `@muse-code/sdk` |

**c) Catálogo ACP** (`packages/app/src/data/acp-provider-catalog.ts`, ~38 entradas
com `id`, `title`, `description`, `version` fixada, `iconSvg`, `installLink`,
`command`, `env?`, `params?`): Agoragentic, Amp, Auggie, Autohand, **Cline**,
Codebuddy, CodeWhale, Cortex Code, Corust, crow-cli, **Cursor**, DeepAgents,
Devin, DimCode, Dirac, Factory Droid, fast-agent, **Gemini CLI**, Gajae Code,
GLM ACP Agent, goose, **Grok**, **Hermes**, Hoplite, Junie, Kilo, **Kimi**, Kiro,
Minimax Code, Minion Code, Mistral Vibe, Nova, Poolside, Qoder, Qwen Code, siGit,
Stakpak, TRAE CLI, VT Code. Ícones SVG próprios por entrada em
`packages/app/src/assets/acp-provider-icons/` (38 arquivos).

Ou seja, dos nomes pedidos: Codex ✓ nativo, Claude ✓ nativo, Grok ✓ catálogo ACP,
Gemini ✓ catálogo ACP (Gemini CLI `--acp`, não Antigravity), Muse ✓ plugin,
Antigravity ✓ plugin, OpenCode ✓ nativo, Copilot ✓ nativo ACP, Pi ✓ nativo,
Cursor ✓ catálogo + shim dedicado, Cline ✓ catálogo, Kimi ✓ catálogo + shim,
Hermes ✓ catálogo. Não há provider nativo "OpenAI-compatible": endpoint custom
entra via `extends: "codex"` ou `extends: "claude"` (seção 2.3).

Shims ACP dedicados (não genéricos) existem p/ Cursor, Kimi, Kiro e TRAE porque
precisam de descoberta de modelos própria (`registry.ts:838-858`): Cursor usa a
extensão `cursor/list_available_models` (trocar modelo na descoberta gravaria
preferências do CLI), Kimi sonda seleções no shim. Os demais ACP caem no
`GenericACPAgentClient`.

### 2.2 Detecção e instalação

**O Paseo não baixa CLI nenhuma.** "Either way, you install the underlying CLI.
Paseo runs it." (`public-docs/providers.md`). Detecção = disponibilidade:

- `AgentClient.isAvailable()`: na base ACP, `super.isAvailable()` verifica se o
  binário de `defaultCommand` está no `$PATH` (via `checkProviderLaunchAvailable`
  / `findExecutable` em `provider-launch-config.ts`); overrides só **adicionam**
  checagem de credencial (ex. do guia: `Boolean(process.env.MY_PROVIDER_API_KEY)`).
  Claude ainda roda `--version` e `auth status` (`providers/claude/agent.ts:1930-1974`).
- Resolução de executável respeita override de comando (seção 2.3) e tem handling
  de launcher no Windows compartilhado entre core e plugins ("SDK process helpers
  share Windows launcher handling with core providers").
- O catálogo ACP é "one-click install" **da configuração**, não do binário: clicar
  em Add grava o provider `extends: "acp"` com o `command` fixado do catálogo
  (muitos via `npx -y <pacote>@<versão> --acp` — a "instalação" é o download do
  pacote npm na primeira execução). Versões são fixadas no catálogo
  (`cline@3.0.73`, `@google/gemini-cli@0.65.0`…), que é "a fonte canônica".
- Status no snapshot (`provider-snapshot-manager.ts`): `loading | ready |
  unavailable | error` por provider (+ `enabled`). `isAvailable() === false` →
  `unavailable` ("not installed"). A app traduz: `ready` = Available (+ nº de
  modelos), `unavailable` = Not installed, `error` = Error, desligado = Disabled
  (`providers-section.tsx`, `getProviderStatus`).

### 2.3 Cadastro/configuração de provider

**Fonte da verdade: `~/.paseo/config.json`** (`$PASEO_HOME/config.json`), sob
`agents.providers.<id>` — validado por Zod em
`paseo: packages/protocol/src/provider-config.ts` (`ProviderOverrideSchema`):

| Campo | Tipo | Uso |
|---|---|---|
| `extends` | `claude\|codex\|copilot\|opencode\|pi\|omp\|acp` | Obrigatório p/ custom; `"acp"` exige `command` |
| `label` | string | Obrigatório p/ custom (nome na UI) |
| `description` | string | Subtítulo na UI |
| `command` | `string[]` | Substitui **inteiramente** o comando de lançamento |
| `env` | `Record<string,string>` | Env do processo (API key, base URL, timeout…) |
| `options` | `Record<string, unknown>` | Opções nativas do provider (`providerOptions`; deep-merge sobre o default a cada launch/resume) |
| `models` | `ProviderProfileModel[]` | Lista estática — **substitui** a descoberta |
| `additionalModels` | `ProviderProfileModel[]` | Mescla com a descoberta (mesmo id = relabel/update in-place) |
| `disallowedTools` | `string[]` | Ex.: `["WebSearch"]` em endpoint não-Anthropic |
| `enabled` | boolean | `false` some da lista (app e CLI) |
| `order` | number | Ordem na lista |

`ProviderProfileModel`: `{ id, label, description?, isDefault?, thinkingOptions? }`;
`ThinkingOption`: `{ id, label, description?, isDefault? }` — é assim que reasoning
effort é declarado p/ modelo customizado.

Padrões de uso documentados (`docs/custom-providers.md`):

- **Endpoint customizado via Claude**: `extends: "claude"` + `ANTHROPIC_BASE_URL` +
  `ANTHROPIC_AUTH_TOKEN`/`ANTHROPIC_API_KEY` (exemplos completos: Z.AI/GLM e
  Alibaba/Qwen, com endpoints de coding plan e pay-as-you-go).
- **Endpoint OpenAI-compatible via Codex**: `extends: "codex"` + `OPENAI_BASE_URL` +
  `OPENAI_API_KEY`. O Paseo injeta no config do Codex
  `model_provider = "paseo:<id>"` com `wire_api = "responses"`,
  `requires_openai_auth = false` e `/v1` appended se faltar. O endpoint **precisa
  falar Responses API**, não só chat completions; modelos **não são descobertos**
  p/ Codex custom — declarar em `models`.
- **Múltiplos perfis do mesmo provider**: várias entradas `extends` com id próprio
  (conta de trabalho × pessoal, "fast" × "smart" com modelo pinado). Cada uma vira
  um provider separado na UI.
- **Binário customizado**: `command: ["/opt/claude-nightly/claude"]` ou wrapper
  script, em built-in ou derivado. "O binário precisa existir; senão o provider é
  marcado indisponível."
- **Desligar**: `{ "enabled": false }` (built-in ou custom). OMP exige
  `enabled: true` p/ aparecer.
- **CLI path customizado** também existe na forma runtime:
  `ProviderRuntimeSettings.command` = `{mode:"default"} | {mode:"append", args} |
  {mode:"replace", argv}` (`ProviderCommandSchema`), resolvido em
  `provider-launch-config.ts` (`resolveProviderLaunch`: replace → argv do usuário;
  append → args extras sobre o default; env mesclado por cima).

**UI de settings** (`packages/app/src/screens/settings/providers-section.tsx`,
React Native — a mesma tela serve desktop/mobile/web):

- Seção **Providers** por host: lista com ícone (`provider-icons.ts`, fallback
  `Bot` genérico), label, **ponto de status** (verde/amarelo/vermelho/cinza +
  spinner), texto de status e contagem de modelos (`· N models`), erro inline
  (até 3 linhas), **Switch** liga/desliga por linha e menu `⋯`
  (`MoreHorizontal`) com *Remove* (só p/ provider custom de config, atrás da
  feature `providerRemoval`).
- Toque na linha abre a **folha de diagnóstico/settings do provider**
  (`provider-settings-host.tsx` + `provider-diagnostic-sheet.tsx`): mostra
  diagnóstico textual completo, modelos descobertos (com busca), modelos
  customizados (com remover), adicionar modelo, copiar diagnóstico.
- Seção **Add provider**: `ProviderCatalogList` — catálogo ACP com busca e botão
  de instalar (grava o patch de config e dá refresh naquele provider).
- Não há campo de formulário para API key/endpoint na UI: **credencial e endpoint
  moram no `config.json`** editado à mão (ou via CLI/SDK). A UI edita o mesmo
  config por `patchConfig` p/ enable/disable, install do catálogo e remoção.

**Teste de conexão / diagnóstico**: `getDiagnostic()` por provider
(`AgentClient.getDiagnostic?()`). Para ACP genérico, o diagnóstico reporta:
comando configurado, binário resolvido (launcher), saída de `--version` (com
probe esperto p/ `npx`: `npx -y <pacote> --version`, não só "npx existe"),
`initialize` ACP, `session/new` ACP, nº de modelos, modos e status final
(`generic-acp-agent.ts`). Probes usam timeouts curtos e env de supressão de
navegador p/ agente que entraria em fluxo OAuth **falhar como erro de diagnóstico
em vez de travar a tela**. O snapshot inteiro tem deadline único por provider
(padrão configurável, `catalogRefreshTimeoutMs` / `PASEO_PROVIDER_REFRESH_TIMEOUT_MS`,
default 2 min no doc do usuário) que cobre disponibilidade + catálogo inteiro.

**Versão**: aparece dentro do diagnóstico (`--version` do binário/launcher), não
como linha de settings com update — não há update gerenciado (contraste direto
com o OpenBot).

### 2.4 Catálogo de modelos e troca mid-chat

Regra geral: **descoberta dinâmica é a fonte da verdade; estático é scaffolding
de UI ou override do usuário** (`docs/providers.md`, *Gotchas*: "Models and modes
are discovered dynamically at runtime"). `fetchCatalog(options)` é a **única** API
de descoberta (modelos + modos); nada fora do provider sonda modelo/modo
separadamente.

- **ACP**: modelos/modos vêm de `session/new` do processo. Override: `models`
  substitui tudo; `additionalModels` mescla.
- **Claude**: exceção curada — manifest estático first-party em
  `providers/claude/model-manifest.ts` ("When adding or updating a Claude model,
  update that manifest only"); `supportedModels()` do SDK é só *gate* de
  visibilidade opt-in, nunca catálogo nem garantia de acesso. Modelos concretos
  de `~/.claude/settings.json` (`model` + `ANTHROPIC_MODEL`,
  `ANTHROPIC_DEFAULT_{FABLE,OPUS,SONNET,HAIKU}_MODEL`,
  `ANTHROPIC_SMALL_FAST_MODEL`) são **anexados** à lista
  (`providers/claude/models.ts`) — é o que deixa usuário de Bedrock/OpenRouter/
  Z.AI via `ANTHROPIC_BASE_URL` selecionar o id exato. `models` no config
  substitui manifest + settings; `additionalModels` só anexa.
- **Codex**: `model/list` do app-server; custom endpoint exige `models` manual.
- **OpenCode**: runtime v1/v2 (alvos 1.14.46 e 2.0.10; v2 recusa < 2.0.10),
  servidor explícito (`PASEO_OPENCODE_SERVER_URL`) → serviço local saudável →
  helper próprio; nunca derruba serviço reusado.
- **Pi/OMP**: `get_available_commands`/RPC; modelos com `model.input` p/ saber se
  aceita imagem (modelo text-only recebe path de arquivo, não bytes — senão o Pi
  persiste a imagem rejeitada no JSONL).

Cache/descoberta (`ProviderSnapshotManager`, contrato em `docs/providers.md`):
resultado cacheado por **identidade** (`getCatalogCacheKey` — inclui config
efetiva e ambiente; Codex/Claude compartilham entre diretórios, perfis custom
não), refresh só explícito ou por mudança de config daquele provider, no máximo
**4 probes concorrentes por provider** (um provider travado não bloqueia os
outros), escolhas salvas de provider/modelo **nunca são apagadas** por falha de
catálogo. Na wire, clientes novos recebem só hash do snapshot
(`provider_snapshot_references`) e pedem o corpo se não conhecerem.

**Troca mid-chat**: `AgentSession.setModel?(modelId)`,
`setThinkingOption?(id)`, `setMode(modeId)` são métodos da sessão viva; quem
encena a troca p/ a próxima volta devolve `AgentProviderNotice` (toast genérico
na app). No Claude, `setModel` chama `activeQuery.setModel(...)` do SDK sem
recriar a sessão (`providers/claude/agent.ts:2751`). Modos têm metadata de UI no
manifest (`icon`, `colorTier: safe|moderate|dangerous|planning`, `isUnattended`)
— o manifest é scaffolding; o runtime manda.

**Reasoning effort**: "thinking options" por modelo (`thinkingOptions` no
`ProviderProfileModel` e no manifest do Claude, derivadas do manifest — "do not
add model-specific Claude capability lists in feature code"). Para ACP, o shim
pode resolver thinking options do modelo atual no probe (Kimi) com cache e
fallback gracioso.

### 2.5 Execução: spawn, streaming, sessão, interrupção

Fronteiras (`docs/providers.md`, *Direct Provider Checklist*): `AgentClient`
(`createSession`, `resumeSession`, `fetchCatalog`, `isAvailable`,
`listImportableSessions`/`importSession` opcionais) e `AgentSession` (`run`,
`startTurn`, `steerActiveTurn?`, `subscribe`, `streamHistory`, `getRuntimeInfo`,
`setMode`, `setModel?`, `setThinkingOption?`, `setFeature?`,
`respondToPermission`, `describePersistence`, `interrupt`, `close`).

- **ACP** (`providers/acp-agent.ts`, ~3400 linhas): `ACPAgentClient` cuida de
  spawn (stdio), transporte JSON-RPC 2.0, ciclo de sessão, streaming,
  permissões e descoberta. Subclasse declara `provider`, `defaultCommand`
  (ex.: `["copilot", "--acp"]`), `defaultModes`, `capabilities`
  (`supportsStreaming`, `supportsSessionPersistence`, `supportsDynamicModes`,
  `supportsMcpServers`, `supportsReasoningStream`, `supportsToolInvocations`).
  Spawn → `initialize` → `session/new` (ou load/resume) → prompts com updates.
  Permissão: o Paseo devolve o `optionId` **exato** escolhido; *Auto Accept* por
  sessão (unattended liga por padrão, desligável); opções `allow` múltiplas do
  mesmo kind viram pergunta de múltipla escolha e **nunca** são auto-aceitas.
- **Claude direto**: Claude Agent SDK com query viva; steer injeta no input da
  query ativa; interrupt chama `query.interrupt()` **só** com turno principal em
  voo (idle atingiria só subagentes) e cancela antes as mensagens enfileiradas.
- **Codex direto**: app-server JSON-RPC (`thread/start`, `turn/start`,
  `turn/steer` com turn esperado + `clientMessageId`, `turn/interrupt`);
  interrupção também precisa matar os comandos shell do turno ("`turn/interrupt`
  ends a turn but leaves the shell commands it started running").
- **OpenCode direto**: eventos de execução v2 encerram o turno (nunca
  `session.wait` — timeout de header HTTP fingia erro com o OpenCode trabalhando);
  bridge de ferramentas via `OPENCODE_CONFIG_CONTENT` (v1: arquivo de plugin;
  v2: pacote com entry point) em loopback privado do daemon.
- **Pi direto**: `pi --mode rpc`; steer nativo enfileira após as tool calls do
  turno; interrupt exige `clear_queue` **antes** de `abort` (senão um steer não
  lido retoma o turno parado). Import de sessões lê os JSONL do Pi (o RPC não
  lista sessões recentes); resume usa o arquivo como `nativeHandle`.
- **OMP direto**: `omp --mode rpc-ui`, aprovações `rpc-ui` viram permissões do
  Paseo, ferramentas do host registradas nativamente (`loadMode: "essential"`).

Persistência: `describePersistence()` só devolve handle quando um **processo
novo** conseguiria retomar (ex.: Codex só após o primeiro turno gravar o
rollout). Sem handle, o daemon guarda `sessionId` com a mesma regra. Reload,
coleta de runtime ocioso e restart do daemon retomam pelo handle guardado.
Import de sessão nativa: `listImportableSessions` devolve só linhas
(handle, cwd, título, previews, última atividade); `importSession` hidrata
**aquela** sessão sem listar de novo.

Steer é contrato opcional com fallback: adapter devolve `unavailable` →
interrupt-and-replace; **erro do adapter não** faz fallback (o destino do steer
é ambíguo). Interrupção deve descartar steers não lidos. Processos helper que
sobrevivem à sessão entram num registro de processos gerenciados do daemon
(PID + comando + identidade da tabela de processos); reconcile na abertura só
mata leftover **positivamente identificado** como do Paseo — "do not add broad
process-name sweepers".

Ferramentas do Paseo p/ o agente: catálogo compartilhado filtrado por provider
(`agents.providers.<id>.paseoTools`); quem registra nativamente
(`supportsNativePaseoTools: true`) recebe sem o MCP interno duplicado; os
demais recebem via MCP `/mcp/agents`. MCP exato pré-aprovado p/ execução
unattended é contrato separado e **fail-closed** p/ provider novo.

### 2.6 Plugins de provider

`@getpaseo/plugin/server/provider` (`docs/providers.md`, *Plugin providers*):
o plugin é dono de transporte, estado de sessão, catálogo e capacidades; registra
o próprio ícone (não entra no mapa da app); o daemon resolve o executável e aplica
`agents.providers.<id>.command`/`env` **antes** de conectar. Provedor novo por
plugin **não precisa** de entrada no manifest nem factory no core. Antigravity e
Muse Code são os dois exemplos embutidos (`plugins/antigravity-provider/`,
com `server/provider.ts`, `catalog.ts`, `process.ts`, `session.ts`…).

---

## 3. Tabela comparativa

| Dimensão | OpenBot | Paseo | Orchbot hoje (provável lacuna) |
|---|---|---|---|
| Nº de providers | 15 fechados + custom ACP/endpoint | 6 core + 2 plugins + ~38 ACP | 8 (`codex, claude, grok, gemini, muse, antigravity, opencode, copilot` em `src/shared/types.ts`) sem ACP genérico |
| Quem instala a CLI | O app (download + hash + update) | O usuário; app só detecta | Só detecta (`checkAvailability`); sem download gerenciado |
| Detecção | `OPENBOT_*_PATH` → gerenciada → login-shell PATH + pastas fixas | `findExecutable` no PATH + override de comando | Provável: PATH simples, sem login-shell PATH (app Electron via Finder/dock tem PATH curto) |
| Gemini | Antigravity ACP (`antigravity`) | Gemini CLI ACP (catálogo) + Antigravity (plugin) | `gemini` e `antigravity` separados — conferir se não duplicam a mesma CLI |
| Muse / Copilot | Muse direto (MSP); Copilot só via ACP custom | Muse plugin; Copilot ACP nativo | `muse` existe; `copilot` sem adapter ACP dedicado provável |
| Cadastro | UI completa (SolidJS) + IPC tipado | `config.json` manual + UI de enable/catalog/remove | UI básica provável; sem `extends`/perfis múltiplos |
| CLI path customizado | `OPENBOT_*_PATH` + path salvo do agente ACP | `command[]` (replace total) e `command.mode append/replace` | Provável: ausente ou só env var |
| Env vars por provider | `extraEnv` a cada spawn + env do agente ACP (criptografado) | `env` no override de config | Parcial (`envKeys` no catálogo = só leitura de presença) |
| API key | `safeStorage`, nunca volta ao renderer; status `missing/saved/unreadable` | Texto no `config.json`; nunca cruza p/ o app | Conferir: se a chave trafega ao renderer, é a lacuna nº 1 |
| Endpoint OpenAI-compatible | Custom provider (harness OpenCode/Pi) c/ descoberta `GET /models` | `extends codex` (Responses API) ou `extends claude` (Anthropic-compat) | `supportsEndpoint: true` no catálogo, sem descoberta provável |
| Modelo padrão | `defaultModel` no descritor + 1º do catálogo | `isDefault` no modelo / perfil; OpenCode sem default estático | Estático no catálogo (`defaultModel`) |
| Reasoning effort | Do CLI (`supportedReasoningEfforts`), fallback `["medium"]` | `thinkingOptions` por modelo (manifest Claude; config p/ custom) | `supportsEffort` booleano — sem opções por modelo provável |
| Auth/login status | `available/sign-in-required/not-installed/outdated/error` + contas múltiplas | `ready/unavailable/error/loading` + enabled | `ProviderAuthStatus: cli/env/missing/unknown` — sem `not-installed` vs `sign-in-required` distintos |
| Versão da CLI | Linha de settings (usuário × gerenciada) + update | Só no diagnóstico (`--version`) | `versionArgs` no catálogo — exibição provável sem update |
| Teste de conexão | Check de conta + `session/new`; Check de agente ACP; Discover models | `getDiagnostic()` completo (binário, versão, initialize, session/new, modelos, modos) | `testConnection` existe na IPC — comparar profundidade com o diagnóstico do Paseo |
| Catálogo de modelos | Dinâmico `model/list` + fallback estático pequeno | Dinâmico `fetchCatalog` (Claude: manifest curado + settings.json) | **Estático** (`models: string[]`, `supportsModelDiscovery: false`) — maior lacuna funcional |
| Troca de modelo mid-chat | Setter vivo (Claude) / próxima volta; troca de provider com handoff 32k | `setModel`/`setThinkingOption`/`setMode` na sessão viva + notice | Provável: só na criação do turno/agente |
| Execução | ACP (8), app-server Codex, SDK Claude, RPC Pi, MSP Muse | ACP, SDK Claude, app-server Codex, runtime OpenCode, RPC Pi/OMP | Adapters por CLI com streaming próprio; sem camada ACP comum provável |
| Sessão persistente/resume | `projection_provider_sessions` + handoff entre providers | `describePersistence` + import de sessões nativas | Conferir handle de resume por provider |
| Interrupção | `session/cancel` + resume mesmo id | `interrupt()` com descarte de steers pendentes | `interrupt()` no registry — sem steer, ok por ora |
| Ícone por provider | `ProviderLogo` (brand package) | SVG por provider + fallback `Bot`; catálogo com SVG próprio | Provável: texto/emoji; copiar o fallback genérico |
| Múltiplas contas/perfis | Contas múltiplas por provider (pastas `GEMINI_HOME` etc.) | Perfis `extends` ilimitados no config | Ausente provável |
| Failover de modelo | Backup models (até 8) com hold e retorno | Não documentado | Ausente provável |

---

## 4. O que copiar (Electron + SolidJS local-first)

Priorizado pelo custo/benefício para o Orchbot:

1. **Tabela única de providers com descritor completo** (OpenBot,
   `agent-providers.ts`). Um array `as const` + `Record<Id, Descriptor> satisfies`
   transforma "provider novo" em erro de compilação onde faltar linha. Campos
   mínimos: `id, displayName, cliName, defaultModel, authKind, pickerOrder,
   installGuideLink, signInMessage, steer, reportsUsage`. Mata as listas
   duplicadas em shared/backend/renderer.
2. **Resolução de CLI em 3 camadas com login-shell PATH** (OpenBot, `cli.ts`).
   App Electron lançado por GUI **não** herda o PATH do terminal — sem
   `loginSearchPath` (cache 60 s) + pastas fixas, "não instalado" vira falso
   positivo. Ordem: env explícita → sistema. (Download gerenciado é opcional;
   detecção boa, não.)
3. **Status em 5 estados, não 2**: `available | sign-in-required | not-installed |
   outdated | error` (OpenBot, `provider-status.ts`), com mensagem redigida e
   versão. Timeout ≠ quebrado. Isso sozinho melhora qualquer tela de settings.
4. **Chave de API só no main, com `safeStorage`** (OpenBot,
   `provider-credential-store.ts`): o renderer recebe `missing|saved|unreadable`
   e `hasApiKey`. Guard na fronteira IPC rejeitando payload com `apiKey` é barato
   de copiar e elimina vazamento por log/resposta.
5. **Descoberta dinâmica de modelos com fallback estático pequeno** (os dois).
   OpenBot: `model/list` uniforme + exceções no driver; Paseo: `fetchCatalog`
   único. Manter a lista estática atual só como *fallback* de picker vazio,
   marcada como não-provada — nunca como catálogo.
6. **`setModel`/`setThinkingOption` na sessão viva** (Paseo, `AgentSession`;
   OpenBot no Claude). Troca de modelo não pode recriar conversa. Se o CLI não
   suporta, aplicar na próxima volta e avisar (padrão `AgentProviderNotice` →
   toast).
7. **Custom provider = endpoint + harness, não provider novo** (OpenBot,
   `ipc-custom-providers.ts`): `baseUrl + apiKey? + headers[] + models[]`
   servidos por um CLI que já existe (OpenCode/Pi). Formulário com *Discover
   models* (`GET {baseUrl}/models` no main, 8 s, chave guardada só na mesma
   origem). Presets Ollama/LM Studio pré-preenchendo.
8. **Detecção local sem chave** (OpenBot, `provider-detection.ts`): probe de
   `127.0.0.1:11434/v1` e `:1234/v1` + scan de comandos ACP conhecidos **sem
   executar nada**, com lista de ocultos. É o onboarding de menor atrito que os
   dois têm.
9. **Agente ACP genérico como válvula de escape** (os dois convergem): um único
   adapter ACP (`initialize → session/new|load → prompt → cancel`, permissões)
   destrava Cursor/Cline/Kimi/Hermes/Gemini CLI/Copilot de uma vez, sem um
   adapter por CLI. No Paseo é literalmente a recomendação ("ACP — recommended");
   no OpenBot, 8 de 15 são ACP com um `AcpFlavor` de quirks por provider.
10. **Diagnóstico em camadas num botão só** (Paseo, `generic-acp-agent.ts`):
    comando configurado → binário resolvido → `--version` → `initialize` →
    `session/new` → nº de modelos/modos → status. Com timeouts curtos e
    supressão de navegador p/ não travar em fluxo OAuth. Substitui `testConnection`
    binário por algo acionável.
11. **Overrides declarativos estilo `extends`** (Paseo, `provider-config.ts`):
    mesmo sem UI, um JSON local `{ extends, label, command, env, models,
    additionalModels, enabled }` dá perfis múltiplos (trabalho/pessoal, endpoint
    Z.AI/Qwen/Ollama) quase de graça sobre os adapters existentes.
12. **Ícone por provider com fallback genérico** (Paseo `provider-icons.ts`;
    OpenBot `ProviderLogo.tsx`): mapa id→SVG + fallback. Não bloquear provider
    novo por falta de logo.
13. **Contratos de sessão honestos** (Paseo): `describePersistence()` só com
    handle retomável por processo novo; interrupção descartando input pendente;
    helper processes registrados por PID (nada de varredura por nome de processo).
14. **Se um dia gerenciar download de CLI**: pin por plataforma + hash da fonte +
    reverificação a cada start + blocklist remota + update que espera turno
    acabar (OpenBot inteiro). É a parte mais cara dos dois projetos — só depois
    dos itens 1–10.

### Anti-padrões observados (não copiar)

- OpenBot: a sofisticação do store de runtimes (claims atômicos entre instâncias,
  stamps de 2 dias) resolve problemas de multi-instância que um app local simples
  não tem. Copiar o *conceito* (verificar hash, manter o anterior até ativar), não
  a máquina toda.
- Paseo: credencial em texto puro no `config.json` é simples, mas inferior ao
  `safeStorage` do OpenBot — para Electron local-first, ficar com o OpenBot aqui.
- Os dois: catálogo de modelos 100% estático por provider (o Orchbot hoje) é o
  que ambos abandonaram — o manifest curado do Claude no Paseo é exceção
  justificada (aliases/entitlement), não regra.

---

## 5. Lacunas prováveis do Orchbot (a verificar no código)

Base: `src/shared/types.ts` (`SupportedProvider`, `ProviderCatalogEntry` com
`models: string[]` e `supportsModelDiscovery: false`), `src/backend/providers/`
(`claude/codex/gemini/grok/muse-adapter.ts`, `registry.ts`, `catalog.ts`).

1. Sem OpenCode, Cursor, Cline, Kimi, Hermes, Pi, nem ACP genérico — o salto de
   cobertura dos dois projetos vem do ACP, não de adapters novos.
2. Catálogo de modelos estático e sem descoberta (`supportsModelDiscovery: false`
   em todos) — some na prática quando a CLI lança modelo novo.
3. Sem perfis múltiplos nem `extends` (duas contas Claude, endpoint custom por
   perfil).
4. `gemini` × `antigravity` como ids separados: conferir se são a mesma CLI por
   baixo (o OpenBot unificou em `antigravity` exibido como "Gemini"; o Paseo usa
   Gemini CLI no catálogo e Antigravity em plugin — são CLIs diferentes, vale
   documentar qual é qual).
5. Sem reasoning effort por modelo (só `supportsEffort` booleano).
6. Sem status `not-installed` distinto de `sign-in-required`, e sem versão da CLI
   com fonte (usuário × gerenciada) na UI.
7. Sem detecção de Ollama/LM Studio nem descoberta `GET /models` de endpoint.
8. Sem troca de modelo mid-chat garantida na sessão viva; sem handoff ao trocar
   de provider.
9. Sem contas múltiplas por provider nem failover por backup models.

---

## Fontes primárias consultadas

**OpenBot** (`nightly-labs/openbot@main`): `docs/architecture/providers.md`;
`packages/contracts/src/agent-providers.ts`, `ipc-custom-providers.ts`,
`ipc-provider-admin.ts`, `ipc-provider-detection.ts`;
`packages/ui/src/features/settings/ProviderSettingsPage.tsx`,
`features/custom-providers/{custom-provider-form,custom-provider-presets,detected-providers}.ts`;
`src/backend/provider-drivers.ts`, `cli.ts`, `acp-client.ts`,
`agent/{model-catalog,provider-models,provider-status}.ts`;
`src/main/provider-detection.ts`, `custom-provider-store.ts`;
`native-runtime.lock.json`, `package.json`, `.github/workflows/provider-cli-canary.yml`.

**Paseo** (`getpaseo/paseo@main`): `docs/providers.md`, `docs/custom-providers.md`;
`public-docs/providers.md`, `public-docs/supported-providers.md`;
`packages/protocol/src/provider-manifest.ts`, `provider-config.ts`;
`packages/server/src/server/agent/provider-registry.ts`, `provider-launch-config.ts`,
`provider-snapshot-manager.ts`, `providers/{acp-agent,generic-acp-agent,copilot-acp-agent,cursor-acp-agent,kimi-acp-agent}.ts`,
`providers/claude/{agent,models,model-manifest}.ts`, `providers/pi/agent.ts`,
`codex-app-server-agent.ts`, `opencode-agent.ts`;
`packages/app/src/screens/settings/providers-section.tsx`,
`components/provider-diagnostic-sheet.tsx`, `data/acp-provider-catalog.ts`,
`utils/provider-definitions.ts`; `plugins/antigravity-provider/`.

**Orchbot** (local, só leitura p/ a seção de lacunas): `src/shared/types.ts`,
`src/backend/providers/{catalog,registry,types}.ts`, `package.json`.
