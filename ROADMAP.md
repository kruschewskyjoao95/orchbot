# Orchbot — Roadmap completo

> Workspace desktop local-first para teammates de IA persistentes (Codex, Claude, Grok via ACP, filas locais, browser embarcado, chat agente-a-agente).
> Este documento é o plano de construção do projeto `Orchbot/`.

## 1. Visão e escopo

### 1.1 O que é
Um app desktop onde cada agente de IA tem:
- workspace próprio no disco,
- conversa persistente,
- fila de mensagens FIFO,
- identidade que sobrevive a restart e troca de provider,
- capacidade de falar com outros agentes, transferir arquivos e controlar um browser embarcado.

### 1.2 Local-first (regra de ouro)
- SQLite local é a fonte da verdade: agentes, conversas, filas, anexos, bindings de sessão.
- Rede só para: providers de modelo, páginas visitadas e plugins.
- Conta cloud (se existir) guarda só identidade, membership e tickets — nunca chats, arquivos ou comandos.

### 1.3 MVP vs pós-MVP
**MVP:**
- Desktop Electron + SolidJS + SQLite.
- 2 providers: Codex App Server + Claude Code.
- Fila persistente, memória básica, agente-a-agente, anexos, browser embarcado simples.
- Sem mobile, sem billing, sem Signal/WebRTC, sem apps de Discord/Slack/Telegram.

**Pós-MVP:**
- ACP genérico (Grok, Gemini, OpenCode, Cursor, Cline, Kimi, Hermes).
- Mobile read-only/remoto, Team API remota, self-hosted/Docker, marketplace de plugins, Computer Use.

---

## 2. Arquitetura alvo

```text
Orchbot/
  src/
    main/        Electron lifecycle, IPC confiável, host server, adapters OS
    preload/     Ponte tipada main <-> renderer (sem regra de negócio)
    backend/     Runtime dos agentes, adapters de provider, filas, storage, browser host
    renderer/    UI SolidJS (só projeção, sem estado durável)
  packages/
    contracts/   Tipos e validação pura das fronteiras (sem Electron/Node/UI/provider)
    ui/          Componentes SolidJS compartilhados
    i18n/        Catálogo de textos (nada de literal na UI)
    logging/     Logger com redação de segredos
    telemetry/   Erros seguros + fila de retry limitada
  scripts/       Dev, smoke, release, verificação
  docs/          Arquitetura por tópico
```

### 2.1 Direção de dependências
```text
renderer ──► contracts ◄── preload ◄── main ──► backend
```
- `renderer` nunca importa `main` ou `backend`.
- `preload` não tem regra de negócio, só mapeia chamadas tipadas para canais IPC.
- `main` valida todo input não-confiável do IPC antes de chamar serviço.
- Provider nunca escreve estado de UI. Ele emite eventos para `AgentService`, que persiste no SQLite antes de notificar o renderer.
- `contracts` não depende de Electron, SolidJS, provider ou Cloudflare.

### 2.2 Donos de estado
| Estado | Dono | Notas |
|---|---|---|
| `orchbot.db` (agentes, conversas, filas, reactions, anexos, bindings) | `backend` | Fonte da verdade, migrações irreversíveis, sem backup assumido |
| Sessões nativas (`~/.codex`, `~/.claude` etc.) | providers | Estado de login/resume, não é storage de conversa |
| `browser-tabs.json` | browser host | Fora do `orchbot.db`, versionado, revalidado a cada leitura |
| Cache de conta no celular | mobile | Cópia cifrada read-only, host é fonte da verdade |
| Contas/memberships/convites | Cloudflare D1 | Nunca chats ou arquivos |

### 2.3 Segurança inegociável
- Manter boundary renderer-main: sandbox Electron, context isolation, navigation policy, validação de sender IPC.
- Agentes rodam com acesso amplo — exigir consentimento explícito no primeiro launch.
- Redigir segredos em todo log, export, diagnóstico e erro.
- Recusar `Origin`/`Host` estranho em listeners loopback.
- Nunca mudar protocolo Team API já lançado.

---

## 3. Modelo de dados (SQLite)

```sql
agents(id, name, provider, model, instructions, avatar, access, workspace_path, created_at)
threads(id, agent_id, kind, native_session_id, ephemeral, persist_session)
messages(id, thread_id, role, text, items_json, created_at, reset_marker)
queues(id, agent_id, payload_json, status, run_source, error, created_at)
attachments(id, owner_kind, owner_id, path, hash, size, manifest_json)
memories(id, agent_id, text, essential, updated_at)
routines(id, agent_id, instruction, trigger_json, next_due_at, paused)
```

- `ConversationRuntime` guarda só trabalho ativo + cache limitado. Histórico completo sempre vem do SQLite.
- Nunca deletar mensagem ausente em uma página de import — commit normalizado sem destructive sync.
- Deleção de agente registra remoção de arquivos numa outbox com retry.

---

## 4. Fases do roadmap

### Fase 0 — Fundação do repo (0.5–1 semana)
- [ ] Inicializar Bun + TypeScript + workspace (`apps/*`, `packages/*`).
- [ ] Lint/format: Biome; testes: Vitest; tipos por projeto (`typecheck:node`, `typecheck:renderer`).
- [ ] Hook pre-commit só em arquivos staged.
- [ ] `docs/architecture/structure.md` com mapa de workspaces e direção de dependências.
- [ ] CI mínima: teste estreito + lint dos arquivos mudados.
- **Sai:** `bun install --frozen-lockfile` verde numa máquina limpa.
- **Validação:** clonar do zero, instalar, rodar 1 teste de exemplo.

### Fase 1 — Shell desktop (1–2 semanas)
- [ ] Electron `main`: lifecycle, janela, updater, tray, deep-link `orchbot://`.
- [ ] `preload`: bridge tipada (`window.orchbot`), sem lógica.
- [ ] `renderer`: SolidJS + roteamento mínimo (lista de agentes, conversa, settings).
- [ ] `packages/contracts`: tipos IPC + limites + validação pura.
- [ ] `packages/ui`: botões, input, lista, modal, toast.
- [ ] `packages/i18n`: catálogo pt/en, zero literal na UI.
- [ ] SQLite + runner de migração + schema inicial.
- **Sai:** app abre, cria agente fake, persiste após restart.
- **Validação:** criar agente → fechar app → reabrir → agente e conversa intactos.

### Fase 2 — Runtime + 2 providers (2–4 semanas)
- [ ] `AgentService`: CRUD de agente, binding thread pública <-> sessão nativa.
- [ ] Adapter Codex via App Server; adapter Claude via SDK.
- [ ] Abstração comum: `startSession`, `sendTurn`, `interrupt`, `getHistory`, `compact?`.
- [ ] Preservar agente/workspace/thread/identidade ao trocar provider ou reiniciar.
- [ ] Monitor de contexto por agente + compaction antes de estourar janela.
- [ ] Config por agente: modelo, reasoning, perfil, notificações, browser, painel.
- **Sai:** 2 agentes reais respondendo, cada um no seu workspace.
- **Validação:** trocar modelo no meio da conversa sem perder histórico; restart sem resetar agente.

### Fase 3 — Filas, história e memória (2–3 semanas)
- [ ] Fila FIFO por agente: enqueue, pause, resume, cancel, retry, persistência crash-safe.
- [ ] Import paginado de histórico por adapter, com progresso salvo.
- [ ] Handoff de sessão substituta com orçamento (ex.: 32k chars: 24k recentes + 4k excertos + 2k work steps + 2k instruções).
- [ ] Ferramentas diferidas `history_search` e `history_read` para recuperar texto omitido.
- [ ] Memórias: `remember` / `forget` / `search_memories` + review em background a cada N turns.
- [ ] Rotinas agendadas: scheduler lê due list, relê antes de iniciar, commit da run antes de avançar trigger.
- **Sai:** mensagens sobrevivem a `kill -9`; contexto longo não quebra.
- **Validação:** matar no meio do turn, retomar, conferir reconciliação; forçar conversa longa e observar compaction/handoff.

### Fase 4 — Colaboração agente-a-agente + arquivos (2 semanas)
- [ ] Ferramentas: `list_agents`, `send_message`, `ask_user`, `react_to_user_message`.
- [ ] Channel chats: um task owner, delegação explícita, controles Stop/Resume/Reassign/Archive/Restore.
- [ ] Formato de reply entre teammates + anti-loop de acknowledgement.
- [ ] Anexos: staging, commit atômico com a mensagem, hash, limites, manifest, outbox de deleção.
- [ ] Direto + descoberta: `tool_search`, `tool_describe`, `tool_call` com roteamento para nomes originais.
- **Sai:** agente A pede algo ao agente B e recebe arquivo de volta.
- **Validação:** 2 agentes trocam texto + imagem + arquivo; deletar agente limpa arquivos via outbox.

### Fase 5 — Browser embarcado (2–3 semanas)
- [ ] Browser persistente com `browser-tabs.json` versionado fora do DB.
- [ ] Execução via CDP: open, inspect, input seguro, `run_script`.
- [ ] Autenticação segura de browser, takeover interativo com approval card.
- [ ] Expor no catálogo como `orchbot_browser.*` com schemas preguiçosos via `tool_search`.
- **Sai:** agente abre página, extrai dado e preenche campo sob supervisão.
- **Validação:** script manual: abrir URL, ler título, clicar, capturar evidência sem vazar segredo em log.

### Fase 6 — Contas, remoto e self-hosted (pós-MVP, 3–4 semanas)
- [ ] Cloudflare Worker + D1: contas, email code, memberships, tickets de conexão, billing (Stripe como fonte de plano).
- [ ] Team API versionada (`*-v1` capabilities: `quiet-turn`, `routine-flows`, `memory-review` etc.).
- [ ] Host local como dono de conversas/arquivos; clientes remotos via Signal/WebRTC ou HTTP relay.
- [ ] Mobile Expo: cache cifrado read-only, notificações, Live Activity.
- [ ] Docker + `install-server.sh` + `orchbot login` para VPS.
- **Sai:** desktop em casa acessível pelo celular; segundo desktop como cliente remoto.
- **Validação:** sign-out/session expiry/server removal apagam cache; D1 nunca contém texto de chat.

### Fase 7 — Plugins, skills e release (contínuo)
- [ ] Pastas de skills + MCP config por agente; biblioteca local de skills.
- [ ] Distribuição de plugins + manifests + permissões.
- [ ] Orçamento de contexto do agente medido (`check:agent-context`).
- [ ] Telemetria privacy-safe, relatórios de erro sem segredo, export de diagnósticos.
- [ ] Electron Builder Mac/Win/AppImage + releases GitHub + status page.
- [ ] Documentar comandos no README, `PRIVACY.md` e `docs/architecture/`.
- **Sai:** release instalável nas 3 plataformas.
- **Validação:** instalar AppImage limpo, instalar plugin exemplo, trocar idioma, exportar diagnósticos e grep por segredo.

---

## 5. Contratos e convenções

- Um método assíncrono de serviço = uma operação que retorna Effect/Promise; sem par Promise+Effect duplicado.
- Erros tipados com `Schema.TaggedError`; mapear para mensagem pública via `user-errors`.
- Decodificar input não-confiável na borda; não revalidar valor interno confiável.
- Recursos com finalizer; respeitar deadlines, retries e cancelamento existentes.
- Texto de UI só via chave i18n.
- Componente compartilhado vai para `@orchbot/ui` antes de duplicar no app.
- Reverse actions sempre testadas aos pares: snooze/unsnooze, pause/resume, revoke/reconnect, mute/unmute.

## 6. Testes e checks por fase

| Fase | Teste obrigatório |
|---|---|
| 0–1 | 1 teste IPC + 1 teste de migração + lint dos mudados |
| 2 | troca de provider sem perda + restart sem reset |
| 3 | kill durante turn + reconciliação; compaction com contexto longo |
| 4 | A→B com anexo; deleção com outbox |
| 5 | open/inspect/input via CDP sem vazar segredo |
| 6 | sign-out limpa cache; D1 sem chat |
| 7 | smoke de instalador + plugin exemplo |

Comandos sugeridos:
```bash
bun install --frozen-lockfile
bun run test:related -- <arquivo-fonte>
bun run test:desktop -- <arquivo-teste>
bun run typecheck:node
bun run typecheck:renderer
biome check --write --max-diagnostics=none <paths>
```

## 7. Riscos e mitigação

- **Agentes com acesso total:** consentimento explícito no primeiro uso, docs de segurança, backups. Não rodar tarefa não-confiável.
- **APIs de providers mudam:** isolar em adapters, ACP como fallback, Team API congelada.
- **Migração destrutiva:** migrações irreversíveis exigem preservar todo schema lançado; nunca assumir backup.
- **Contexto explode:** catálogo preguiçoso + `tool_search`, handoff orçado, medição de bytes de instrução.
- **Segredo vaza em log:** redação centralizada + teste que faz grep em exports.
- **Scope creep (mobile/billing cedo demais):** deixar para Fase 6/7; MVP prova valor só local.

## 8. Estimativa e ordem sugerida

1. Fase 0 + 1 — esqueleto que persiste.
2. Fase 2 — primeiro valor real (2 agentes reais).
3. Fase 3 — robustez (filas + memória).
4. Fase 4 — diferencial (colaboração + arquivos).
5. Fase 5 — diferencial 2 (browser).
6. Fase 6–7 — escala e distribuição.

Estimativa para 1 dev experiente: MVP (Fases 0–5 enxutas) em 8–14 semanas; Fases 6–7 adicionam 4–8 semanas.

## 9. Status atual e próximos passos

> Atualizado na sessão de implementação do design + providers + orquestração.
> O núcleo abaixo já está implementado e testado no app (Electron + SolidJS + SQLite).

### 9.1 Já implementado

- [x] Design system híbrido (desktop denso + respiro visual), temas dark/light/sistema, escala de interface e cor do logotipo.
- [x] 10 providers com adapters reais: Codex, Claude, Grok, Gemini, Muse, Antigravity, OpenCode, Copilot, Pi e Kimi.
- [x] Catálogo único de providers (`src/backend/providers/catalog.ts`): comando, modelos, env keys, esforço e descoberta de modelos via CLI (Antigravity/OpenCode).
- [x] Configuração de provider que vale na execução: caminho da CLI, API key, endpoint e esforço chegam ao turno.
- [x] Ícone de configuração ⚙ por provider (card e sidebar) com modal de configuração avançada.
- [x] Detecção de atualização de CLI (npm) com banner, notificação nativa, dispensar por versão e botão Atualizar.
- [x] Projetos (pastas criadas no disco) agrupando robôs na sidebar.
- [x] Robô com nome, descrição (o que ele faz), instruções, esforço próprio e modo de contexto.
- [x] Orquestrador: usuário fala só com ele; ele delega aos especialistas do projeto e resume os resultados.
- [x] Economia de tokens: modo Econômico/Padrão/Completo por robô, histórico resumido e regras truncadas por modo.
- [x] Navegador dos robôs: abrir/inspecionar/clicar/preencher painéis web (Meta Ads, Google Ads) com login persistente por robô.
- [x] Uso do computador: listar apps, screenshot, abrir app, clicar, digitar e teclas (grim/hyprctl/wtype), com status de prontidão.
- [x] Configurações: Geral, Aparência, Conversas, Comportamento do app, Agents (Defaults com contagem `x of N on`) e Permissões.
- [x] Defaults de Agents com override por robô: scripts locais, iniciar novos chats, plano antes de tarefas longas, orientar (Fila/Imediato).
- [x] Aba Perfil: tokens estimados, mensagens, sequências, heatmap de 365 dias, destaques, colegas mais ativos e uso de modelos.
- [x] Pesquisa de referência salva em `docs/research-providers-openbot-paseo.md`.
- [x] Suíte de testes cobrindo providers, projetos, orquestração, contexto, navegador, computador, perfil, updates e configurações.

### 9.2 Falta implementar — prioridade alta (nesta ordem)

1. [x] **Chave segura (`safeStorage`)** — chaves cifradas no SQLite, migração das antigas e renderer recebe apenas indicação de chave cadastrada; fallback Linux `basic_text` bloqueado.
2. [x] **Adapter ACP genérico** — cliente ACP v1 por stdio, comando/argumentos configuráveis pela tela, streaming, cancelamento, descoberta de modelos via configOptions e confirmação nativa de permissões. Ver `docs/acp.md`.
3. [x] **Provedor customizado pela tela** — cadastro de APIs OpenAI-compatible com chave protegida, edição/remoção, streaming HTTP, descoberta de modelos e integração com robôs e fallback. Ver `docs/custom-providers.md`.
4. [x] **Sessão persistente do CLI** — resume nativo de Codex/Claude por conversa, IDs persistidos no SQLite, isolamento de workspace/conexão, cancelamento ordenado e reinício explícito sem apagar mensagens. Ver `docs/native-sessions.md`.

### 9.3 Falta implementar — prioridade média

5. [x] **Várias contas por provedor** — chaves próprias, perfis isolados de Codex/Claude, seleção por robô e fallback de cota entre contas antes de trocar de provedor. Ver `docs/provider-accounts.md`.
6. [x] **Instalação gerenciada de CLI** — instala o CLI em pasta própria do app (`npm --prefix`), com versão fixada e remoção, usado automaticamente quando não há caminho próprio. Ver `docs/distribution.md`.
7. [x] **Status de login fino** — estados separados, checagens reais em Codex/Claude/Pi/OpenCode/Muse e ACP; versões ou CLIs sem verificação segura ficam como login não verificado. Ver `docs/provider-login-status.md`.
8. [ ] **Uso real de tokens** — ler o consumo reportado pela CLI em vez de estimar por caracteres no Perfil.
9. [x] **Update fora do npm** — Grok (`grok update`) e Pi (`pi update --self`) atualizam pelo próprio CLI; Muse e Antigravity não têm canal (a tela explica o motivo).
10. [ ] **Contexto Git no turno** — injetar status/diff/commits recentes do workspace no contexto do agente.

### 9.4 Falta implementar — segunda onda

11. [ ] **Visão de verdade** — enviar screenshot (navegador/computador) para modelo com visão em vez de só texto.
12. [ ] **Update do próprio Orchbot** — empacotamento, auto-update do app, bandeja do sistema e autostart no Linux.
13. [ ] **Traduções reais** — hoje só Português (Brasil); seletor de idioma já persiste a preferência.
14. [ ] **Envio de análises** — a permissão existe; falta o serviço/coletor (nenhum dado é enviado hoje).
15. [ ] **Acesso remoto/mobile e voz** — salto de escopo (relay, app mobile, ditado). Só com decisão explícita de escopo.

### 9.5 Ordem recomendada

`safeStorage` → ACP genérico → provedor customizado → sessão persistente. Depois a fila 9.3 na ordem. A 9.4 só entra com decisão de produto.

## 10. Checklist de pronto (DoD do MVP)

- [ ] Dois agentes (Codex + Claude) com workspaces isolados.
- [ ] Restart preserva tudo; troca de provider não reseta agente.
- [ ] Fila FIFO com pause/resume/cancel persistente.
- [ ] Agente-a-agente com arquivo funcionando.
- [ ] Browser embarcado controlável pelo agente.
- [ ] Nenhum chat/arquivo sai da máquina; diagnóstico sem segredo.
- [ ] Instalador + README com comandos + docs de arquitetura atualizados.
