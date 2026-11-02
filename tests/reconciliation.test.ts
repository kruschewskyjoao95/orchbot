import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { OrchbotDatabase } from '../src/backend/storage/db'

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
})
