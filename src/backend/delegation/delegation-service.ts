import type { DelegationInput, Message, TaskQueueItem } from '../../shared/types'
import type { QueueManager } from '../queue/queue-manager'
import type { OrchbotDatabase } from '../storage/db'

export class DelegationService {
  private static MAX_DELEGATION_DEPTH = 2

  constructor(
    private db: OrchbotDatabase,
    private queueManager: QueueManager,
  ) {}

  public async delegate(
    input: DelegationInput,
  ): Promise<{ task: TaskQueueItem; message: Message }> {
    const fromAgent = this.db.getAgent(input.fromAgentId)
    if (!fromAgent) {
      throw new Error(`Agente de origem não encontrado: ${input.fromAgentId}`)
    }

    const toAgent = this.db.getAgent(input.toAgentId)
    if (!toAgent) {
      throw new Error(`Agente de destino não encontrado: ${input.toAgentId}`)
    }

    if (input.fromAgentId === input.toAgentId) {
      throw new Error('Um agente não pode delegar uma tarefa para si mesmo')
    }

    // Anti-loop: valida profundidade de delegação
    let nextDepth = 1
    if (input.parentTaskId) {
      const parentTask = this.db.getTask(input.parentTaskId)
      const currentDepth = parentTask?.delegationDepth ?? 1
      if (currentDepth >= DelegationService.MAX_DELEGATION_DEPTH) {
        throw new Error(
          `Limite máximo de profundidade de delegação atingido (${DelegationService.MAX_DELEGATION_DEPTH}). Interrompendo para evitar loop entre agentes.`,
        )
      }
      nextDepth = currentDepth + 1
    }

    // Busca a thread principal do agente de destino
    const toThreads = this.db.listThreads(toAgent.id)
    if (toThreads.length === 0) {
      throw new Error(`Nenhuma conversa disponível para o agente de destino: ${toAgent.name}`)
    }
    const targetThread = toThreads[0]

    // Formata o texto indicando claramente a proveniência da delegação
    const delegationPrompt = `[Tarefa Delegada por ${fromAgent.name} (${fromAgent.provider})]:\n${input.prompt}`

    // 1. Registra mensagem na conversa do agente de destino
    const message = this.db.addMessage(
      targetThread.id,
      'user',
      delegationPrompt,
      fromAgent.id,
      toAgent.id,
    )

    // 2. Enfileira a tarefa na fila durável do agente de destino com a profundidade calculada
    const task = this.queueManager.enqueue(toAgent.id, targetThread.id, delegationPrompt, nextDepth)

    return { task, message }
  }
}
