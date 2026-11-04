import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  calculateNextRun,
  describeCron,
  isValidCron,
  matchesDate,
  normalizeCronExpression,
} from '../src/backend/cron/cron-parser'
import { CronScheduler } from '../src/backend/cron/scheduler'
import { ProviderRegistry } from '../src/backend/providers/registry'
import type {
  ActiveExecution,
  ExecutionCallbacks,
  ExecutionOptions,
  ProviderAdapter,
} from '../src/backend/providers/types'
import { QueueManager } from '../src/backend/queue/queue-manager'
import { OrchbotDatabase } from '../src/backend/storage/db'
import type { Agent, ProviderInfo, SupportedProvider } from '../src/shared/types'

class MockCronAdapter implements ProviderAdapter {
  public readonly id: SupportedProvider = 'codex'
  public readonly name = 'Mock Cron Provider'
  public executedTurns: Array<{ prompt: string; options: ExecutionOptions }> = []

  public checkAvailability(): Promise<ProviderInfo> {
    return Promise.resolve({
      provider: 'codex',
      name: 'Mock Cron Provider',
      available: true,
      models: ['gpt-4o'],
      defaultModel: 'gpt-4o',
    })
  }

  public executeTurn(
    prompt: string,
    options: ExecutionOptions,
    callbacks: ExecutionCallbacks,
  ): ActiveExecution {
    this.executedTurns.push({ prompt, options })
    setTimeout(() => {
      callbacks.onChunk('OK Cron', 'OK Cron')
      callbacks.onDone('OK Cron')
    }, 15)
    return { interrupt: () => {} }
  }
}

describe('Agendamento & Tarefas em Background (Cron)', () => {
  let db: OrchbotDatabase
  let registry: ProviderRegistry
  let queueManager: QueueManager
  let mockAdapter: MockCronAdapter
  let testAgent: Agent
  let scheduler: CronScheduler

  beforeEach(() => {
    db = new OrchbotDatabase(':memory:')
    registry = new ProviderRegistry()
    mockAdapter = new MockCronAdapter()
    registry.registerAdapter(mockAdapter)
    queueManager = new QueueManager(db, registry)

    testAgent = db.createAgent({
      name: 'Bot Cron',
      provider: 'codex',
      model: 'gpt-4o',
      workspacePath: '/home/joao/test-workspace',
    })
  })

  afterEach(() => {
    scheduler?.close()
    queueManager?.close()
    db.close()
  })

  describe('Cron Parser & Calculador de Próxima Execução', () => {
    it('normaliza atalhos e aliases conhecidos', () => {
      expect(normalizeCronExpression('@daily')).toBe('0 0 * * *')
      expect(normalizeCronExpression('@morning_9am')).toBe('0 9 * * *')
      expect(normalizeCronExpression('@hourly')).toBe('0 * * * *')
      expect(normalizeCronExpression('@every_5_minutes')).toBe('*/5 * * * *')
      expect(normalizeCronExpression('@every_30_minutes')).toBe('*/30 * * * *')
    })

    it('valida expressões cron sintaticamente', () => {
      expect(isValidCron('0 9 * * *')).toBe(true)
      expect(isValidCron('*/15 * * * *')).toBe(true)
      expect(isValidCron('0 0 1 * *')).toBe(true)
      expect(isValidCron('@daily')).toBe(true)
      expect(isValidCron('@morning_9am')).toBe(true)
      expect(isValidCron('invalido')).toBe(false)
      expect(isValidCron('0 9 *')).toBe(false)
      expect(isValidCron('0 9 * * * * *')).toBe(false)
    })

    it('faz correspondência exata de datas com a expressão cron', () => {
      const date9am = new Date(2026, 10, 2, 9, 0, 0) // 09:00
      const date10am = new Date(2026, 10, 2, 10, 0, 0) // 10:00

      expect(matchesDate('0 9 * * *', date9am)).toBe(true)
      expect(matchesDate('0 9 * * *', date10am)).toBe(false)

      const date15min = new Date(2026, 10, 2, 14, 15, 0)
      const date17min = new Date(2026, 10, 2, 14, 17, 0)
      expect(matchesDate('*/15 * * * *', date15min)).toBe(true)
      expect(matchesDate('*/15 * * * *', date17min)).toBe(false)
    })

    it('trata 7 como domingo no intervalo e combina dia do mês ou dia da semana', () => {
      const at = (day: number, month = 10) => new Date(2026, month, day, 9, 0, 0)
      const sunday = at(8)
      const friday = at(6)
      const saturday = at(7)
      const thursday = at(5)

      expect(matchesDate('0 9 * * 5-7', friday)).toBe(true)
      expect(matchesDate('0 9 * * 5-7', saturday)).toBe(true)
      expect(matchesDate('0 9 * * 5-7', sunday)).toBe(true)
      expect(matchesDate('0 9 * * 5-7', thursday)).toBe(false)
      expect(matchesDate('0 9 * * 7', sunday)).toBe(true)
      expect(matchesDate('0 9 * * 1-5', sunday)).toBe(false)

      // 1º de novembro de 2026 é domingo; dia 2 é segunda; 1º de dezembro é terça.
      expect(matchesDate('0 9 1 * 1', at(1))).toBe(true)
      expect(matchesDate('0 9 1 * 1', at(2))).toBe(true)
      expect(matchesDate('0 9 1 * 1', at(4))).toBe(false)
      expect(matchesDate('0 9 1 * 1', at(1, 11))).toBe(true)
      // */2 conta como livre: dia ímpar E segunda (9 é segunda ímpar; 2 é segunda par; 3 é terça ímpar).
      expect(matchesDate('0 9 */2 * 1', at(9))).toBe(true)
      expect(matchesDate('0 9 */2 * 1', at(2))).toBe(false)
      expect(matchesDate('0 9 */2 * 1', at(3))).toBe(false)
      expect(matchesDate('0 9 1 * *', at(2))).toBe(false)
      expect(matchesDate('0 9 * * 1', at(1, 11))).toBe(false)

      const next = calculateNextRun('0 9 * * 5-7', new Date(2026, 10, 7, 10, 0, 0))
      expect(next).toEqual(new Date(2026, 10, 8, 9, 0, 0))
    })

    it('calcula o próximo horário de execução no futuro', () => {
      const base = new Date(2026, 10, 2, 8, 30, 0) // 08:30
      const nextRun = calculateNextRun('0 9 * * *', base)

      expect(nextRun.getHours()).toBe(9)
      expect(nextRun.getMinutes()).toBe(0)
      expect(nextRun.getTime()).toBeGreaterThan(base.getTime())
    })

    it('gera descrição legível em português', () => {
      expect(describeCron('0 9 * * *')).toBe('Todo dia às 09:00')
      expect(describeCron('@morning_9am')).toBe('Todo dia às 09:00')
      expect(describeCron('*/5 * * * *')).toBe('A cada 5 minutos')
      expect(describeCron('0 0 * * *')).toBe('Todo dia à meia-noite (00:00)')
      expect(describeCron('0 0 * * 0')).toBe('Todo domingo às 00:00')
    })
  })

  describe('Persistência SQLite de Agendamentos (scheduled_tasks)', () => {
    it('cria, recupera e lista agendamentos associados a um agente', () => {
      const task = db.createScheduledTask({
        agentId: testAgent.id,
        title: 'Verificar issues e testes',
        prompt:
          'Todo dia às 09:00 verifique as issues abertas ou rode a suíte de testes e me dê um resumo.',
        cronExpression: '0 9 * * *',
        taskType: 'routine',
      })

      expect(task.id).toBeDefined()
      expect(task.title).toBe('Verificar issues e testes')
      expect(task.enabled).toBe(true)
      expect(task.nextRunAt).toBeDefined()

      const fetched = db.getScheduledTask(task.id)
      expect(fetched?.id).toBe(task.id)
      expect(fetched?.prompt).toContain('rode a suíte de testes')

      const list = db.listScheduledTasks(testAgent.id)
      expect(list.length).toBe(1)
      expect(list[0].id).toBe(task.id)
    })

    it('atualiza propriedades e alterna ativação do agendamento', () => {
      const task = db.createScheduledTask({
        agentId: testAgent.id,
        title: 'Rotina Antiga',
        prompt: 'Prompt antigo',
        cronExpression: '*/30 * * * *',
      })

      const updated = db.updateScheduledTask({
        id: task.id,
        title: 'Rotina Atualizada',
        enabled: false,
      })

      expect(updated.title).toBe('Rotina Atualizada')
      expect(updated.enabled).toBe(false)

      const reFetched = db.getScheduledTask(task.id)
      expect(reFetched?.enabled).toBe(false)
    })

    it('identifica tarefas prontas para execução (getDueScheduledTasks)', () => {
      const pastDate = new Date(Date.now() - 60000).toISOString()
      const futureDate = new Date(Date.now() + 600000).toISOString()

      const taskDue = db.createScheduledTask({
        agentId: testAgent.id,
        title: 'Tarefa no Passado',
        prompt: 'Executar agora',
        cronExpression: '0 9 * * *',
      })
      db.updateScheduledTask({ id: taskDue.id, nextRunAt: pastDate })

      const taskFuture = db.createScheduledTask({
        agentId: testAgent.id,
        title: 'Tarefa no Futuro',
        prompt: 'Não executar ainda',
        cronExpression: '0 9 * * *',
      })
      db.updateScheduledTask({ id: taskFuture.id, nextRunAt: futureDate })

      const due = db.getDueScheduledTasks()
      const dueIds = due.map((t) => t.id)
      expect(dueIds).toContain(taskDue.id)
      expect(dueIds).not.toContain(taskFuture.id)
    })

    it('deleta agendamento', () => {
      const task = db.createScheduledTask({
        agentId: testAgent.id,
        title: 'Deletar',
        prompt: 'Prompt',
        cronExpression: '@daily',
      })

      const deleted = db.deleteScheduledTask(task.id)
      expect(deleted).toBe(true)
      expect(db.getScheduledTask(task.id)).toBeNull()
    })
  })

  describe('Execução em Background pelo CronScheduler', () => {
    it('dispara rotina agendada ("verifique issues ou rode testes"), enfileira no QueueManager e atualiza próximo disparo', async () => {
      let triggered = false
      scheduler = new CronScheduler(db, queueManager, undefined, {
        onTaskTriggered: () => {
          triggered = true
        },
      })

      const task = db.createScheduledTask({
        agentId: testAgent.id,
        title: 'Resumo Diário de Issues e Testes',
        prompt: 'Verifique as issues abertas ou rode a suíte de testes e me dê um resumo.',
        cronExpression: '0 9 * * *',
        taskType: 'routine',
      })

      // Simula que a tarefa já venceu
      db.updateScheduledTask({
        id: task.id,
        nextRunAt: new Date(Date.now() - 5000).toISOString(),
      })

      const count = await scheduler.checkAndRunDueTasks()
      expect(count).toBe(1)
      expect(triggered).toBe(true)

      // Aguarda processamento pela fila do QueueManager
      await new Promise((resolve) => setTimeout(resolve, 80))

      // 1. Mensagem de aviso de sistema inserida no chat
      const threads = db.listThreads(testAgent.id)
      const messages = db.listMessages(threads[0].id)
      const systemNotice = messages.find((m) => m.role === 'system')
      expect(systemNotice?.text).toContain(
        'Rotina agendada "Resumo Diário de Issues e Testes" disparada via Cron',
      )

      // 2. Tarefa foi enfileirada e executada pelo provedor
      expect(mockAdapter.executedTurns.length).toBeGreaterThan(0)
      expect(mockAdapter.executedTurns[0].prompt).toContain('AGENDAMENTO AUTOMÁTICO - ROTINA CRON')
      expect(mockAdapter.executedTurns[0].prompt).toContain(
        'Verifique as issues abertas ou rode a suíte de testes',
      )

      // 3. O registro no banco teve last_run_at e next_run_at atualizados
      const afterRun = db.getScheduledTask(task.id)
      expect(afterRun?.lastRunAt).toBeDefined()
      expect(afterRun?.nextRunAt).toBeDefined()
      expect(new Date(afterRun?.nextRunAt || '').getTime()).toBeGreaterThan(Date.now())
    })

    it('dispara rotina de monitoramento periódico de página via navegador embarcado', async () => {
      scheduler = new CronScheduler(db, queueManager)

      const monitorTask = db.createScheduledTask({
        agentId: testAgent.id,
        title: 'Monitorar Status da Página de Deploy',
        prompt: 'Verifique se há avisos de erro ou falha no dashboard.',
        cronExpression: '*/30 * * * *',
        taskType: 'browser_monitor',
        targetUrl: 'https://status.github.com',
      })

      // Dispara imediatamente via runNow
      await scheduler.runNow(monitorTask.id)

      await new Promise((resolve) => setTimeout(resolve, 80))

      expect(mockAdapter.executedTurns.length).toBe(1)
      const prompt = mockAdapter.executedTurns[0].prompt
      expect(prompt).toContain('AGENDAMENTO AUTOMÁTICO - MONITORAMENTO DE PÁGINA')
      expect(prompt).toContain('https://status.github.com')
      expect(prompt).toContain('Verifique se há avisos de erro ou falha no dashboard')
    })

    it('desliga a rotina com expressão cron inválida em vez de agendar "agora"', async () => {
      scheduler = new CronScheduler(db, queueManager)
      const task = db.createScheduledTask({
        agentId: testAgent.id,
        title: 'Quebrada',
        prompt: 'x',
        cronExpression: '*/30 * * * *',
      })
      db.updateScheduledTask({ id: task.id, cronExpression: 'invalido' })
      await scheduler.runNow(task.id)
      expect(db.getScheduledTask(task.id)?.enabled).toBe(false)
      expect(db.getDueScheduledTasks(new Date(Date.now() + 60_000).toISOString())).toEqual([])
    })
  })
})
