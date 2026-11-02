import type { Message, StreamChunkEvent, TaskQueueItem } from '../../shared/types'
import type { ProviderRegistry } from '../providers/registry'
import type { OrchbotDatabase } from '../storage/db'

export interface QueueManagerEvents {
  onStreamChunk: (event: StreamChunkEvent) => void
  onTurnFinished: (event: { threadId: string; message: Message; task: TaskQueueItem }) => void
  onTurnError: (event: { threadId: string; error: string; task: TaskQueueItem }) => void
  onTaskStatusChanged: (event: { task: TaskQueueItem }) => void
}

export class QueueManager {
  private pausedAgents = new Set<string>()
  private isProcessingAgent = new Set<string>()
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

  public enqueue(agentId: string, threadId: string, prompt: string): TaskQueueItem {
    const task = this.db.enqueueTask(agentId, threadId, prompt)
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

    const execution = adapter.executeTurn(
      nextTask.prompt,
      {
        workspacePath: agent.workspacePath,
        model: agent.model,
        instructions: agent.instructions,
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
