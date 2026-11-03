import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ProviderRegistry } from '../src/backend/providers/registry'
import type {
  ActiveExecution,
  ExecutionCallbacks,
  ExecutionOptions,
  ProviderAdapter,
} from '../src/backend/providers/types'
import { QueueManager, isQuotaOrRateLimitError } from '../src/backend/queue/queue-manager'
import { OrchbotDatabase } from '../src/backend/storage/db'
import type { ProviderInfo, SupportedProvider } from '../src/shared/types'

class MockProviderAdapter implements ProviderAdapter {
  public readonly name: string
  constructor(
    public readonly id: SupportedProvider,
    private shouldFailWith429 = false,
  ) {
    this.name = `Mock ${id}`
  }

  public checkAvailability(): Promise<ProviderInfo> {
    return Promise.resolve({
      provider: this.id,
      name: this.name,
      available: true,
      models: ['mock-model'],
      defaultModel: 'mock-model',
    })
  }

  public setFailWith429(fail: boolean) {
    this.shouldFailWith429 = fail
  }

  public executeTurn(
    prompt: string,
    _options: ExecutionOptions,
    callbacks: ExecutionCallbacks,
  ): ActiveExecution {
    let cancelled = false
    const timer = setTimeout(() => {
      if (cancelled) return
      if (this.shouldFailWith429) {
        callbacks.onError('429 Too Many Requests: Rate limit exceeded or quota exhausted')
      } else {
        callbacks.onChunk('Resp: ', 'Resp: ')
        callbacks.onChunk(prompt, `Resp: ${prompt}`)
        callbacks.onDone(`Resp: ${prompt}`)
      }
    }, 20)

    return {
      interrupt: () => {
        cancelled = true
        clearTimeout(timer)
      },
    }
  }
}

describe('Modo de Autonomia & Failover Automático de Cota', () => {
  let db: OrchbotDatabase
  let registry: ProviderRegistry
  let queueManager: QueueManager

  beforeEach(() => {
    db = new OrchbotDatabase(':memory:')
    registry = new ProviderRegistry()
  })

  afterEach(() => {
    queueManager?.close()
    db.close()
  })

  it('detecta corretamente mensagens de erro associadas a cota ou rate limit (429)', () => {
    expect(isQuotaOrRateLimitError('429 Too Many Requests')).toBe(true)
    expect(isQuotaOrRateLimitError('Error: Insufficient_quota for project')).toBe(true)
    expect(isQuotaOrRateLimitError('You exceeded your current quota, please check your plan')).toBe(
      true,
    )
    expect(isQuotaOrRateLimitError('resource_exhausted: Tokens per min exceeded')).toBe(true)
    expect(isQuotaOrRateLimitError('500 Internal Server Error')).toBe(false)
    expect(isQuotaOrRateLimitError('SyntaxError: Unexpected token in JSON')).toBe(false)
    expect(isQuotaOrRateLimitError('')).toBe(false)
  })

  it('persiste e atualiza o nível de autonomia do agente (cautious vs autonomous)', () => {
    const agent = db.createAgent({
      name: 'Agent Cauteloso',
      provider: 'codex',
      model: 'gpt-4o',
      workspacePath: '/home/joao/workspace',
      autonomyLevel: 'cautious',
    })

    expect(agent.autonomyLevel).toBe('cautious')

    const fetched = db.getAgent(agent.id)
    expect(fetched?.autonomyLevel).toBe('cautious')

    const updated = db.updateAgent({
      id: agent.id,
      autonomyLevel: 'autonomous',
    })
    expect(updated.autonomyLevel).toBe('autonomous')

    const reFetched = db.getAgent(agent.id)
    expect(reFetched?.autonomyLevel).toBe('autonomous')
  })

  it('realiza failover automático transparente de Codex para Claude quando ocorre 429 de cota', async () => {
    const codexAdapter = new MockProviderAdapter('codex', true) // falha com 429
    const claudeAdapter = new MockProviderAdapter('claude', false) // responde com sucesso

    registry.registerAdapter(codexAdapter)
    registry.registerAdapter(claudeAdapter)

    const agent = db.createAgent({
      name: 'Dev Failover',
      provider: 'codex',
      model: 'gpt-4o',
      workspacePath: '/home/joao/workspace',
    })

    const thread = db.createThread(agent.id, 'Thread de Teste Failover')

    // Certifica que Claude está habilitado nas conexões
    db.updateConnection({
      providerId: 'claude',
      enabled: true,
      defaultModel: 'claude-3-7-sonnet',
    })

    queueManager = new QueueManager(db, registry)

    // Enfileira uma tarefa no agente
    const task = queueManager.enqueue(agent.id, thread.id, 'Criar migration de banco de dados')
    expect(task.status).toBe('pending')

    // Aguarda o ciclo de execução, o failover e a conclusão pelo Claude
    await new Promise((resolve) => setTimeout(resolve, 350))

    // 1. O agente deve ter migrado transparentemente para o Claude
    const currentAgent = db.getAgent(agent.id)
    expect(currentAgent?.provider).toBe('claude')
    expect(currentAgent?.model).toBe('claude-3-7-sonnet')

    // 2. O histórico do chat deve conter o aviso de sistema sobre o failover e a resposta final
    const messages = db.listMessages(thread.id)
    const systemNotice = messages.find((m) => m.role === 'system')
    expect(systemNotice).toBeDefined()
    expect(systemNotice?.text).toContain('CODEX / Padrão')
    expect(systemNotice?.text).toContain('CLAUDE / Padrão')

    // 3. A mensagem final do assistente deve estar gravada
    const assistantMsg = messages.find((m) => m.role === 'assistant')
    expect(assistantMsg).toBeDefined()
    expect(assistantMsg?.text).toBe('Resp: Criar migration de banco de dados')

    // 4. A tarefa deve estar como completada
    const finalTask = db.getTask(task.id)
    expect(finalTask?.status).toBe('completed')
  })

  it('injeta diretrizes de Modo Cauteloso nas instruções de execução do turno', async () => {
    let capturedInstructions = ''

    const customAdapter: ProviderAdapter = {
      id: 'codex',
      name: 'Custom Codex',
      checkAvailability: () =>
        Promise.resolve({
          provider: 'codex',
          name: 'Custom Codex',
          available: true,
          models: ['gpt-4o'],
          defaultModel: 'gpt-4o',
        }),
      executeTurn: (prompt, options, callbacks) => {
        capturedInstructions = options.instructions || ''
        setTimeout(() => {
          callbacks.onDone('OK')
        }, 10)
        return { interrupt: () => {} }
      },
    }

    registry.registerAdapter(customAdapter)

    const agent = db.createAgent({
      name: 'Agent Cauteloso Turn',
      provider: 'codex',
      model: 'gpt-4o',
      workspacePath: '/home/joao/workspace',
      autonomyLevel: 'cautious',
    })

    const thread = db.createThread(agent.id, 'Thread Cautelosa')
    queueManager = new QueueManager(db, registry)

    queueManager.enqueue(agent.id, thread.id, 'Realizar clique no botão de checkout')

    await new Promise((resolve) => setTimeout(resolve, 60))

    expect(capturedInstructions).toContain('NÍVEL DE AUTONOMIA: 🛡️ MODO CAUTELOSO')
    expect(capturedInstructions).toContain(
      'Peça confirmação expressa ao usuário antes de qualquer clique no navegador',
    )
  })
})
