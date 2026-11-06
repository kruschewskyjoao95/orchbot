import type { RequestPermissionRequest } from '@agentclientprotocol/sdk'
import type {
  McpToolPolicy,
  ProviderEffort,
  ProviderInfo,
  ProviderModelCatalog,
  SupportedProvider,
} from '../../shared/types'

/** Servidor MCP já com segredos abertos, pronto para virar flags do CLI. */
export interface McpLaunchServer {
  name: string
  transport: 'stdio' | 'http'
  command?: string
  args: string[]
  url?: string
  env: Record<string, string>
  bearerToken?: string
  toolPolicy?: McpToolPolicy
}

export interface ProviderRuntimeConfig {
  docker?: { workspacePath: string }
  /** MCP configurado para este agente (só Claude e Codex aplicam). */
  mcpServers?: McpLaunchServer[]
  /** Variáveis extras do processo filho (segredos de MCP; nunca vão no argv). */
  extraEnv?: Record<string, string>
  accountAuthMode?: 'api_key' | 'cli_profile'
  cliProfile?: { envKey: 'CODEX_HOME' | 'CLAUDE_CONFIG_DIR'; directory: string }
  model?: string
  cliPath?: string
  cliArgs?: string[]
  apiKeyEnv?: string
  apiKey?: string
  endpoint?: string
  effort?: ProviderEffort
  envKeys?: string[]
}

export interface ExecutionOptions {
  workspacePath: string
  /** Pastas fora do workspace que o agente pode ler e escrever (ex.: `shared/` do projeto). */
  extraDirs?: string[]
  /**
   * Modo cauteloso. 'ask': comando de terminal e edição param e pedem permissão (Claude) ou
   * o terminal fica só leitura (Codex). 'approved': turno logo depois de uma aprovação.
   * Ausente: modo autônomo, sem mudança.
   */
  permission?: 'ask' | 'approved'
  resumeSessionId?: string
  model?: string
  instructions?: string
  providerConfig?: ProviderRuntimeConfig
}

/** Uso de tokens informado pela própria CLI (nada aqui é estimado). */
export interface TurnUsage {
  /** Tokens de entrada do turno, já somando o que veio de cache. */
  inputTokens: number
  outputTokens: number
  cachedTokens?: number
  /** O contador é acumulado da sessão inteira (Codex): quem consome precisa tirar o delta. */
  cumulative?: boolean
  /** Tamanho do contexto na última requisição do turno (o que realmente ocupa a janela). */
  contextTokens?: number
  /** Janela de contexto do modelo, quando a CLI informa. */
  contextWindow?: number
}

export interface ExecutionCallbacks {
  onUsage?: (usage: TurnUsage) => void
  /** Aviso visível ao usuário (ex.: um recurso que o provedor não aceitou). */
  onNotice?: (text: string) => void
  onSessionId?: (sessionId: string) => void
  onInterrupted?: () => void
  onPermissionRequest?: (
    request: RequestPermissionRequest,
    signal: AbortSignal,
  ) => Promise<string | undefined>
  onChunk: (chunk: string, fullText: string) => void
  onError: (error: string) => void
  onDone: (fullText: string) => void
}

export interface ActiveExecution {
  interrupt: () => void
}

export interface ProviderAdapter {
  readonly id: SupportedProvider
  readonly name: string
  readonly supportsSessionResume?: boolean
  checkAvailability(config?: ProviderRuntimeConfig): Promise<ProviderInfo>
  executeTurn(
    prompt: string,
    options: ExecutionOptions,
    callbacks: ExecutionCallbacks,
  ): ActiveExecution
  discoverModelCatalog?(config?: ProviderRuntimeConfig): Promise<ProviderModelCatalog>
  discoverModels?(config?: ProviderRuntimeConfig): Promise<string[]>
}
