export type SupportedProvider = 'codex' | 'claude'

export interface Agent {
  id: string
  name: string
  provider: SupportedProvider
  model: string
  instructions: string
  workspacePath: string
  avatar?: string
  createdAt: string
  updatedAt: string
}

export interface CreateAgentInput {
  name: string
  provider: SupportedProvider
  model: string
  instructions?: string
  workspacePath: string
}

export interface Thread {
  id: string
  agentId: string
  title: string
  createdAt: string
}

export interface Message {
  id: string
  threadId: string
  role: 'user' | 'assistant' | 'system'
  text: string
  createdAt: string
}

export interface SystemStatus {
  appVersion: string
  platform: string
  dbPath: string
}

export interface OrchbotApi {
  getAgents: () => Promise<Agent[]>
  getAgent: (id: string) => Promise<Agent | null>
  createAgent: (input: CreateAgentInput) => Promise<Agent>
  deleteAgent: (id: string) => Promise<boolean>
  getThreads: (agentId: string) => Promise<Thread[]>
  getMessages: (threadId: string) => Promise<Message[]>
  getSystemStatus: () => Promise<SystemStatus>
}

export function validateCreateAgentInput(raw: unknown): CreateAgentInput {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('Entrada inválida para criação de agente')
  }

  const { name, provider, model, instructions, workspacePath } = raw as Record<string, unknown>

  if (typeof name !== 'string' || name.trim().length === 0) {
    throw new Error('O nome do agente é obrigatório')
  }

  if (provider !== 'codex' && provider !== 'claude') {
    throw new Error('Provedor inválido (suportados: codex, claude)')
  }

  if (typeof model !== 'string' || model.trim().length === 0) {
    throw new Error('O modelo é obrigatório')
  }

  if (typeof workspacePath !== 'string' || workspacePath.trim().length === 0) {
    throw new Error('O caminho do workspace é obrigatório')
  }

  return {
    name: name.trim(),
    provider,
    model: model.trim(),
    instructions: typeof instructions === 'string' ? instructions.trim() : '',
    workspacePath: workspacePath.trim(),
  }
}
