# Orchbot 🤖

> **Desktop workspace local-first para agentes de IA persistentes**  
> Construído com Electron, SolidJS, TypeScript, Bun e SQLite nativo.

---

## 🌟 Visão Geral

O **Orchbot** é um ambiente de trabalho desktop local-first para hospedar, orquestrar e colaborar com múltiplos agentes de IA no seu próprio computador:

- **Identidade Persistente por Agente**: cada agente possui seu próprio workspace em disco, seu modelo/instruções, sua conversa persistente e sua fila de tarefas durável.
- **Local-First por Design**: SQLite local (`orchbot.db`) é a única fonte da verdade. Nenhum histórico, arquivo ou conversa é enviado para nuvem proprietária.
- **Suporte Multi-Provedor Nativo (Codex & Claude)**: utiliza diretamente as assinaturas ativas do usuário através dos CLIs oficiais (`codex` e `claude`), com streaming de resposta em tempo real e interrupção graciosa de turnos.
- **Várias contas por provedor**: cadastre chaves próprias ou perfis separados de Codex/Claude em Conexões → Contas, escolha a conta por robô e alterne automaticamente entre contas em erros de cota. [Como usar](docs/provider-accounts.md).
- **Status de login**: distingue pronto, precisa entrar, não instalado e falhas de checagem; resultados inconclusivos ficam como login não verificado. Veja [checagens por provedor](docs/provider-login-status.md).
- **Sessões nativas de Codex e Claude**: cada conversa retoma seu próprio ID de sessão, inclusive depois de reiniciar o app. Veja [continuidade e recuperação de sessões](docs/native-sessions.md).
- **Provedores personalizados**: cadastre APIs OpenAI-compatible pela tela, incluindo Ollama, OpenRouter e DeepSeek, com chave protegida, streaming e descoberta de modelos. Veja [como cadastrar](docs/custom-providers.md).
- **Agente ACP genérico**: conecte um agente ACP v1 por stdio, configurando executável e argumentos na tela. Veja [como configurar ACP](docs/acp.md).
- **Fila FIFO Durável e Crash-Safe**: tarefas são salvas no banco antes de executar; sobrevivem a reinicializações e falhas com reconciliação automática de tarefas pendentes ou interrompidas (`reconcileRunningTasks`).
- **Recibos de Webhook**: o cabeçalho opcional `Idempotency-Key` evita criar trabalho duplicado por sete dias, inclusive após reiniciar. [Contrato e limites](docs/webhooks.md).
- **Anexos Gerenciados com SHA-256**: staging e deduplicação de arquivos em diretório gerenciado com hashing criptográfico e limite de segurança de 50 MB.
- **Colaboração e Delegação Entre Agentes**: agentes podem delegar subtarefas para outros agentes com prevenção estrita contra ciclos e loops infinitos (`MAX_DELEGATION_DEPTH = 2`).
- **Navegador Embarcado Supervisionado**: browser com persistência de abas em `browser-tabs.json`, partições de sessão isoladas por agente (`persist:orchbot-agent-<id>`), bloqueio de popups e protocolos inseguros, inspeção de DOM sanitizada com redação de segredos e catálogo de ferramentas `orchbot_browser.*`.
- **Distribuição Linux Completa**: binários independentes para Linux empacotados em formato **AppImage** e executável descompactado.

---

## 🏗️ Arquitetura

```text
src/
├── main/                   # Processo Principal Electron (Lifecycle, Janela, IPC confiável)
├── preload/                # Ponte restrita e tipada (window.orchbot) sem lógica de negócio
├── renderer/               # Interface desktop reativa em SolidJS
├── backend/
│   ├── storage/            # SQLite nativo (node:sqlite DatabaseSync) e AttachmentManager (SHA-256)
│   ├── providers/          # Adapters para Codex CLI e Claude Code CLI
│   ├── queue/              # Fila durável FIFO por agente e reconciliação crash-safe
│   ├── delegation/         # Serviço de delegação entre agentes com controle anti-loop
│   └── browser/            # BrowserManager, TabStore (browser-tabs.json), Sanitizer e Driver
└── shared/                 # Contratos, tipos TypeScript e validação de fronteiras
```

---

## 🚀 Como Executar

### Pré-requisitos
- **Linux** (x64)
- **Bun** (v1.2+) ou **Node.js** (v22+)
- (Opcional) CLI do **Codex** (`npm i -g @openai/codex`) ou **Claude Code** (`npm i -g @anthropic-ai/claude-code`) configurados para chat real.

### Instalação
```bash
bun install
```

### Modo de Desenvolvimento
```bash
bun run dev
```

### Testes Automatizados (Vitest)
```bash
bun run test
```

### Verificação de Lint e Formatação (Biome)
```bash
bun run lint
# ou para aplicar correções automáticas:
bun run lint:fix
```

### Compilação de Produção
```bash
bun run build
```

### Empacotamento para Linux (AppImage & Executável)
```bash
# Gera o executável em diretório linux-unpacked:
bun run package:dir

# Gera o arquivo binário independente .AppImage em dist/:
bun run package:appimage
```

O arquivo final será gerado em:
`dist/Orchbot-0.1.0.AppImage`

Para executar diretamente:
```bash
chmod +x dist/Orchbot-0.1.0.AppImage
./dist/Orchbot-0.1.0.AppImage
```

---

## 🔒 Segurança e Privacidade

1. **Context Isolation & Sandbox**: A interface gráfica (`renderer`) não possui acesso direto ao Node.js nem ao sistema de arquivos; toda comunicação passa por canais IPC validados no `preload`.
2. **Redação de Segredos**: O módulo `sanitizer` detecta e mascara tokens, senhas e chaves de API (`[REDACTED_SECRET]`) antes de exibir em logs ou inspeção de DOM.
3. **Isolamento de Sessão Web**: Cada agente opera seu navegador com partição persistente exclusiva (`persist:orchbot-agent-<id>`), impedindo vazamento de cookies ou credenciais entre agentes distintos.
4. **Sem Dependência de Serviços Cloud**: O aplicativo não depende de servidores remotos de autenticação ou banco de dados externo para funcionar.
