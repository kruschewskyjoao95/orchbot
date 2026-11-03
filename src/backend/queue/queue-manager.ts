import type { Message, StreamChunkEvent, TaskQueueItem } from '../../shared/types'
import type { ProviderRegistry } from '../providers/registry'
import { loadWorkspaceRules } from '../rag/workspace-rules'
import type { OrchbotDatabase } from '../storage/db'

export interface QueueManagerEvents {
  onStreamChunk: (event: StreamChunkEvent) => void
  onTurnFinished: (event: { threadId: string; message: Message; task: TaskQueueItem }) => void
  onTurnError: (event: { threadId: string; error: string; task: TaskQueueItem }) => void
  onTaskStatusChanged: (event: { task: TaskQueueItem }) => void
}

export function isQuotaOrRateLimitError(error: string): boolean {
  if (!error) return false
  const lower = error.toLowerCase()
  return (
    lower.includes('429') ||
    lower.includes('too many requests') ||
    lower.includes('quota') ||
    lower.includes('rate_limit') ||
    lower.includes('rate limit') ||
    lower.includes('insufficient_quota') ||
    lower.includes('resource_exhausted') ||
    lower.includes('overloaded') ||
    lower.includes('exceeded your current quota') ||
    lower.includes('capacity exceeded') ||
    lower.includes('tokens per min') ||
    lower.includes('requests per min')
  )
}

export class QueueManager {
  private pausedAgents = new Set<string>()
  private isProcessingAgent = new Set<string>()
  private taskFallbackAttempts = new Map<string, Set<string>>()
  private isClosed = false

  constructor(
    private db: OrchbotDatabase,
    private registry: ProviderRegistry,
    private events?: Partial<QueueManagerEvents>,
  ) {
    // Reconciliação imediata na inicialização
    this.reconcile()
  }

  public close(): void {
    this.isClosed = true
  }

  public setEvents(events: QueueManagerEvents): void {
    this.events = events
  }

  public reconcile(): number {
    return this.db.reconcileRunningTasks()
  }

  public isPaused(agentId: string): boolean {
    return this.pausedAgents.has(agentId)
  }

  public pause(agentId: string): boolean {
    this.pausedAgents.add(agentId)
    return true
  }

  public resume(agentId: string): boolean {
    this.pausedAgents.delete(agentId)
    // Tenta processar próxima tarefa pendente
    setTimeout(() => {
      this.processNextForAgent(agentId)
    }, 0)
    return true
  }

  public enqueue(
    agentId: string,
    threadId: string,
    prompt: string,
    delegationDepth = 1,
  ): TaskQueueItem {
    const task = this.db.enqueueTask(agentId, threadId, prompt, delegationDepth)
    this.events?.onTaskStatusChanged?.({ task })

    // Dispara processamento
    setTimeout(() => {
      this.processNextForAgent(agentId)
    }, 0)

    return task
  }

  public cancel(taskId: string): boolean {
    const task = this.db.getTask(taskId)
    if (!task) return false

    if (task.status === 'running') {
      this.registry.interruptThread(task.threadId)
    }

    const updated = this.db.updateTaskStatus(taskId, 'cancelled', 'Cancelado pelo usuário')
    this.isProcessingAgent.delete(task.agentId)
    this.events?.onTaskStatusChanged?.({ task: updated })

    // Processa próximo da fila se o cancelado estava rodando
    if (task.status === 'running') {
      setTimeout(() => {
        this.processNextForAgent(task.agentId)
      }, 0)
    }

    return true
  }

  public retry(taskId: string): boolean {
    const task = this.db.getTask(taskId)
    if (!task) return false

    const updated = this.db.updateTaskStatus(taskId, 'pending', null)
    this.events?.onTaskStatusChanged?.({ task: updated })

    setTimeout(() => {
      this.processNextForAgent(task.agentId)
    }, 0)

    return true
  }

  public listTasks(agentId: string): TaskQueueItem[] {
    return this.db.listTasks(agentId)
  }

  private async processNextForAgent(agentId: string): Promise<void> {
    if (this.isClosed || !this.db.isOpen()) {
      return
    }

    if (this.pausedAgents.has(agentId)) {
      return
    }

    if (this.isProcessingAgent.has(agentId)) {
      return
    }

    const nextTask = this.db.getNextPendingTask(agentId)
    if (!nextTask) {
      return
    }

    this.isProcessingAgent.add(agentId)

    // Atualiza para status 'running'
    const runningTask = this.db.updateTaskStatus(nextTask.id, 'running')
    this.events?.onTaskStatusChanged?.({ task: runningTask })

    const agent = this.db.getAgent(agentId)
    if (!agent) {
      this.isProcessingAgent.delete(agentId)
      const failed = this.db.updateTaskStatus(nextTask.id, 'failed', 'Agente não encontrado')
      this.events?.onTaskStatusChanged?.({ task: failed })
      return
    }

    const adapter = this.registry.getAdapter(agent.provider)

    // 1. Diretrizes do Projeto (ORCHBOT.md / AGENTS.md)
    const rules = loadWorkspaceRules(agent.workspacePath)
    const contextSections: string[] = []

    if (rules.exists && rules.content) {
      contextSections.push(`[DIRETRIZES DO PROJETO (${rules.filename})]\n${rules.content}`)
    }

    // 2. Memória Contínua FTS5 (histórico de conversas anteriores relevantes)
    try {
      const relevantMsgs = this.db.searchMessages(nextTask.prompt, {
        agentId,
        limit: 3,
      })
      const filteredMsgs = relevantMsgs.filter((m) => m.text.trim() !== nextTask.prompt.trim())
      if (filteredMsgs.length > 0) {
        const memoryText = filteredMsgs
          .map((m) => `- [Conversa "${m.threadTitle}" (${m.role})]: ${m.text.slice(0, 300)}`)
          .join('\n')
        contextSections.push(
          `[MEMÓRIA DO PROJETO / HISTÓRICO DE CONVERSAS ANTERIORES]\n${memoryText}`,
        )
      }
    } catch {
      // Ignora falhas de busca de memória
    }

    // 3. Trechos relevantes do repositório (RAG local)
    try {
      const relevantFiles = this.db.searchWorkspaceFiles(agentId, nextTask.prompt, 3)
      if (relevantFiles.length > 0) {
        const filesText = relevantFiles
          .map((f) => `- [Arquivo ${f.fileName}]: ${f.snippet.replace(/<\/?b>/g, '')}`)
          .join('\n')
        contextSections.push(`[TRECHOS RELEVANTES DO REPOSITÓRIO]\n${filesText}`)
      }
    } catch {
      // Ignora falhas de busca em arquivos
    }

    // 4. Instruções originais do agente
    if (agent.instructions?.trim()) {
      contextSections.push(`[INSTRUÇÕES DO AGENTE]\n${agent.instructions.trim()}`)
    }

    // 5. Nível de Autonomia do Agente
    if (agent.autonomyLevel === 'cautious') {
      contextSections.push(
        '[NÍVEL DE AUTONOMIA: 🛡️ MODO CAUTELOSO]\nVocê está operando em Modo Cauteloso. Peça confirmação expressa ao usuário antes de qualquer clique no navegador, preenchimento de campos ou comandos de terminal. Não execute ações destrutivas ou de escrita externa sem validação prévia.',
      )
    } else {
      contextSections.push(
        '[NÍVEL DE AUTONOMIA: ⚡ MODO AUTÔNOMO]\nVocê está operando em Modo Autônomo. Execute as tarefas e subtarefas da fila sequencialmente até concluir o objetivo com precisão.',
      )
    }

    const effectiveInstructions =
      contextSections.length > 0 ? contextSections.join('\n\n') : undefined

    const execution = adapter.executeTurn(
      nextTask.prompt,
      {
        workspacePath: agent.workspacePath,
        model: agent.model,
        instructions: effectiveInstructions,
      },
      {
        onChunk: (chunk, fullText) => {
          this.events?.onStreamChunk?.({
            threadId: nextTask.threadId,
            chunk,
            fullText,
          })
        },
        onError: (error) => {
          // Failover transparente de cota (429 Too Many Requests / Quota Exceeded)
          if (isQuotaOrRateLimitError(error)) {
            const tried = this.taskFallbackAttempts.get(nextTask.id) ?? new Set<string>()
            tried.add(agent.provider)
            this.taskFallbackAttempts.set(nextTask.id, tried)

            const enabledConnections = this.db.listConnections().filter((c) => c.enabled)
            const fallback = enabledConnections.find((c) => !tried.has(c.providerId))

            if (fallback) {
              this.registry.removeActiveExecution(nextTask.threadId)
              this.isProcessingAgent.delete(agentId)

              // 1. Mensagem de sistema avisando ao usuário sobre o failover automático
              const failoverNotice = `⚠️ Cota ou limite de requisições excedido no provedor ${agent.provider.toUpperCase()} (${error}). Realizando failover automático e transparente para ${fallback.providerId.toUpperCase()} (${fallback.defaultModel})...`
              const systemMsg = this.db.addMessage(nextTask.threadId, 'system', failoverNotice)
              this.events?.onTurnFinished?.({
                threadId: nextTask.threadId,
                message: systemMsg,
                task: nextTask,
              })

              // 2. Atualiza o agente para o provedor e modelo alternativo
              this.db.updateAgent({
                id: agent.id,
                provider: fallback.providerId,
                model: fallback.defaultModel,
              })

              // 3. Reseta status da tarefa para pendente
              this.db.updateTaskStatus(nextTask.id, 'pending')

              // 4. Continua a execução imediatamente com o novo provedor
              setTimeout(() => {
                this.processNextForAgent(agentId)
              }, 50)
              return
            }
          }

          // Se não houver fallback habilitado ou não for erro de cota
          this.taskFallbackAttempts.delete(nextTask.id)
          this.registry.removeActiveExecution(nextTask.threadId)
          this.isProcessingAgent.delete(agentId)

          const failedTask = this.db.updateTaskStatus(nextTask.id, 'failed', error)
          this.events?.onTaskStatusChanged?.({ task: failedTask })
          this.events?.onTurnError?.({
            threadId: nextTask.threadId,
            error,
            task: failedTask,
          })

          // Continua processando a fila do agente
          setTimeout(() => {
            this.processNextForAgent(agentId)
          }, 50)
        },
        onDone: (fullText) => {
          this.taskFallbackAttempts.delete(nextTask.id)
          this.registry.removeActiveExecution(nextTask.threadId)
          this.isProcessingAgent.delete(agentId)

          // 1. Grava a mensagem do assistente no histórico do chat
          const assistantMsg = this.db.addMessage(
            nextTask.threadId,
            'assistant',
            fullText.trim() || '(Nenhum conteúdo retornado)',
          )

          // 2. Marca a tarefa como concluída no banco
          const completedTask = this.db.updateTaskStatus(nextTask.id, 'completed')
          this.events?.onTaskStatusChanged?.({ task: completedTask })
          this.events?.onTurnFinished?.({
            threadId: nextTask.threadId,
            message: assistantMsg,
            task: completedTask,
          })

          // 3. Processa próxima tarefa da fila FIFO
          setTimeout(() => {
            this.processNextForAgent(agentId)
          }, 50)
        },
      },
    )

    this.registry.registerActiveExecution(nextTask.threadId, execution)
  }
}
