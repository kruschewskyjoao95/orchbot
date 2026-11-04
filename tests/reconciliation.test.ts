import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProviderRegistry } from '../src/backend/providers/registry'
import { QueueManager } from '../src/backend/queue/queue-manager'
import { OrchbotDatabase } from '../src/backend/storage/db'
import { CONSENT_VERSION } from '../src/shared/types'

describe('Fase 3: Reconciliação e Resiliência a Quedas (Crash-Safety)', () => {
  const testDbDir = path.resolve(__dirname, '../.test-reconcile-tmp')
  const testDbPath = path.join(testDbDir, 'reconcile-test.db')

  beforeEach(() => {
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath)
  })

  afterEach(() => {
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath)
    if (fs.existsSync(`${testDbPath}-wal`)) fs.unlinkSync(`${testDbPath}-wal`)
    if (fs.existsSync(`${testDbPath}-shm`)) fs.unlinkSync(`${testDbPath}-shm`)
    if (fs.existsSync(testDbDir)) fs.rmdirSync(testDbDir)
  })

  it('deve identificar tarefas em execução durante crash e reconciliar como interrompidas', () => {
    // 1. Sessão antes do crash: inicia uma tarefa e marca como 'running'
    const session1 = new OrchbotDatabase(testDbPath)
    const agent = session1.createAgent({
      name: 'CrashBot',
      provider: 'codex',
      model: 'gpt-4o',
      workspacePath: '/tmp/crash',
    })
    const threads = session1.listThreads(agent.id)

    const task = session1.enqueueTask(agent.id, threads[0].id, 'Tarefa Crítica em Execução')
    session1.updateTaskStatus(task.id, 'running')

    expect(session1.getTask(task.id)?.status).toBe('running')

    // Simula encerramento forçado (kill -9) sem fechar a tarefa
    session1.close()

    // 2. Nova sessão após reiniciar o aplicativo:
    const session2 = new OrchbotDatabase(testDbPath)
    const reconciledCount = session2.reconcileRunningTasks()

    expect(reconciledCount).toBe(1)

    const reconciledTask = session2.getTask(task.id)
    expect(reconciledTask?.status).toBe('interrupted')
    expect(reconciledTask?.error).toContain('Interrompido por encerramento inesperado')
    expect(reconciledTask?.completedAt).toBeDefined()

    // O usuário pode recuperar e dar retry na tarefa
    const retriedTask = session2.updateTaskStatus(task.id, 'pending', null)
    expect(retriedTask.status).toBe('pending')
    expect(retriedTask.error).toBeNull()

    session2.close()
  })

  it.each([
    { consented: true, paused: false },
    { consented: false, paused: false },
    { consented: true, paused: true },
  ])(
    'retoma pendências após reiniciar (aceite: $consented, pausa: $paused)',
    async ({ consented, paused }) => {
      const session1 = new OrchbotDatabase(testDbPath)
      const agent = session1.createAgent({
        name: 'RestartBot',
        provider: 'codex',
        model: 'test',
        workspacePath: '/tmp/crash',
      })
      if (consented)
        session1.updateSettings({
          consentAcceptedAt: new Date().toISOString(),
          consentVersion: CONSENT_VERSION,
        })
      session1.setAgentPaused(agent.id, paused)
      const thread = session1.listThreads(agent.id)[0]
      const interrupted = session1.enqueueTask(agent.id, thread.id, 'Não repetir')
      session1.updateTaskStatus(interrupted.id, 'running')
      const first = session1.enqueueTask(agent.id, thread.id, 'Primeira pendência')
      const second = session1.enqueueTask(agent.id, thread.id, 'Segunda pendência')
      session1.close()

      const session2 = new OrchbotDatabase(testDbPath)
      const registry = new ProviderRegistry()
      const prompts: string[] = []
      registry.registerAdapter({
        id: 'codex',
        name: 'Restart provider',
        checkAvailability: async () => ({ available: true }),
        executeTurn: (prompt, _options, callbacks) => {
          prompts.push(prompt)
          setTimeout(() => callbacks.onDone('Concluído'), 0)
          return { interrupt() {} }
        },
      })
      const queue = new QueueManager(session2, registry)
      try {
        queue.setConsentCheck(() => {
          const settings = session2.getSettings()
          return (
            Boolean(settings.consentAcceptedAt) && (settings.consentVersion ?? 0) >= CONSENT_VERSION
          )
        })
        expect(session2.getTask(interrupted.id)?.status).toBe('interrupted')
        if (!consented || paused) {
          await new Promise((resolve) => setTimeout(resolve, 30))
          expect(prompts).toEqual([])
          expect(session2.getTask(first.id)?.status).toBe('pending')
          expect(session2.getTask(second.id)?.status).toBe('pending')
          if (paused) queue.resume(agent.id)
          else {
            session2.updateSettings({
              consentAcceptedAt: new Date().toISOString(),
              consentVersion: CONSENT_VERSION,
            })
            queue.kick()
          }
        }
        await vi.waitFor(() => expect(session2.getTask(second.id)?.status).toBe('completed'))
        expect(prompts).toEqual(['Primeira pendência', 'Segunda pendência'])
        expect(session2.getTask(first.id)?.status).toBe('completed')
        expect(session2.getTask(interrupted.id)?.status).toBe('interrupted')
      } finally {
        queue.close()
        session2.close()
      }
    },
  )
})
