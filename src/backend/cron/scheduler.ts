import type { ScheduledTask } from '../../shared/types'
import type { BrowserManager } from '../browser/browser-manager'
import type { QueueManager } from '../queue/queue-manager'
import type { OrchbotDatabase } from '../storage/db'
import { calculateNextRun, isValidCron } from './cron-parser'

export interface CronSchedulerOptions {
  tickIntervalMs?: number
  onTaskTriggered?: (task: ScheduledTask) => void
}

export class CronScheduler {
  private timer: ReturnType<typeof setInterval> | null = null
  private isChecking = false
  private isClosed = false

  constructor(
    private db: OrchbotDatabase,
    private queueManager: QueueManager,
    private browserManager?: BrowserManager,
    private options: CronSchedulerOptions = {},
  ) {}

  public start(): void {
    if (this.timer || this.isClosed) return

    const interval = this.options.tickIntervalMs || 10000
    this.timer = setInterval(() => {
      this.checkAndRunDueTasks().catch(() => {
        // Ignora erros no tick para não quebrar o loop do scheduler
      })
    }, interval)

    // Executa verificação inicial logo ao iniciar
    setTimeout(() => {
      this.checkAndRunDueTasks().catch(() => {})
    }, 100)
  }

  public stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  public close(): void {
    this.isClosed = true
    this.stop()
  }

  public isRunning(): boolean {
    return this.timer !== null
  }

  public async checkAndRunDueTasks(): Promise<number> {
    if (this.isChecking || this.isClosed) return 0
    this.isChecking = true

    let triggeredCount = 0
    try {
      const now = new Date()
      const dueTasks = this.db.getDueScheduledTasks(now.toISOString())

      for (const task of dueTasks) {
        try {
          await this.executeScheduledTask(task, now)
          triggeredCount++
        } catch {
          // Garante que o erro em uma tarefa não impeça o agendamento das outras
        }
      }
    } finally {
      this.isChecking = false
    }

    return triggeredCount
  }

  public async runNow(taskId: string): Promise<boolean> {
    const task = this.db.getScheduledTask(taskId)
    if (!task) {
      throw new Error(`Agendamento "${taskId}" não encontrado`)
    }

    await this.executeScheduledTask(task, new Date())
    return true
  }

  private async executeScheduledTask(task: ScheduledTask, executionTime: Date): Promise<void> {
    const nowIso = executionTime.toISOString()

    // 1. Resolve ou cria thread de destino para o agente
    let targetThreadId = task.threadId
    if (targetThreadId) {
      const existingThread = this.db.getThread(targetThreadId)
      if (!existingThread) targetThreadId = null
    }

    if (!targetThreadId) {
      const active = this.db.getActiveThread(task.agentId)
      if (active) {
        targetThreadId = active.id
      } else {
        const newThread = this.db.createThread(task.agentId, `[Cron] ${task.title}`)
        targetThreadId = newThread.id
      }
    }

    // 2. Monta o prompt contextualizado conforme o tipo de tarefa agendada
    let prompt: string
    if (task.taskType === 'browser_monitor') {
      const targetUrl = task.targetUrl || 'URL não informada'
      prompt = `[AGENDAMENTO AUTOMÁTICO - MONITORAMENTO DE PÁGINA]\nRotina: ${task.title}\nData/Hora: ${executionTime.toLocaleString()}\nURL Alvo: ${targetUrl}\nInstrução de monitoramento: ${task.prompt}\n(Por favor, acesse ou inspecione a página indicada e gere um resumo conciso com o status atual e quaisquer novidades detectadas.)`
    } else {
      prompt = `[AGENDAMENTO AUTOMÁTICO - ROTINA CRON "${task.title}"]\nData/Hora: ${executionTime.toLocaleString()}\nInstrução agendada: ${task.prompt}`
    }

    // 3. Adiciona mensagem de aviso de sistema no histórico da conversa
    const systemNotice = `⏰ Rotina agendada "${task.title}" disparada via Cron (${task.cronExpression}). Enfileirando tarefa de execução...`
    this.db.addMessage(targetThreadId, 'system', systemNotice)

    // 4. Enfileira a tarefa na fila durável FIFO do agente
    this.queueManager.enqueue(task.agentId, targetThreadId, prompt)

    // 5. Calcula próximo disparo e registra execução no banco
    let nextRunIso = nowIso
    if (isValidCron(task.cronExpression)) {
      nextRunIso = calculateNextRun(task.cronExpression, executionTime).toISOString()
    }
    this.db.recordScheduledTaskRun(task.id, nowIso, nextRunIso)

    // 6. Notifica ouvinte externo
    this.options.onTaskTriggered?.(task)
  }
}
