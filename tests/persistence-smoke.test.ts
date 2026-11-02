import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { OrchbotDatabase } from '../src/backend/storage/db'
import { validateCreateAgentInput } from '../src/shared/types'

describe('DoD Fase 1: Persistência após reinicialização', () => {
  const testDbDir = path.resolve(__dirname, '../.test-tmp')
  const testDbPath = path.join(testDbDir, 'test-orchbot.db')

  it('deve criar um agente, fechar a conexão, reabrir e encontrar os dados intactos', () => {
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath)
    }

    // 1. Primeira sessão: abre o banco e cadastra o agente
    const session1 = new OrchbotDatabase(testDbPath)
    const input = validateCreateAgentInput({
      name: 'PersistBot',
      provider: 'codex',
      model: 'gpt-4o',
      workspacePath: '/home/joao/Documents/Orchbot',
      instructions: 'Instruções persistentes de teste'
    })

    const createdAgent = session1.createAgent(input)
    expect(createdAgent.id).toBeDefined()
    expect(session1.listAgents().length).toBe(1)

    // Simula encerramento do app
    session1.close()

    // 2. Segunda sessão: app foi reaberto
    const session2 = new OrchbotDatabase(testDbPath)
    const agentsAfterRestart = session2.listAgents()

    expect(agentsAfterRestart.length).toBe(1)
    expect(agentsAfterRestart[0].id).toBe(createdAgent.id)
    expect(agentsAfterRestart[0].name).toBe('PersistBot')
    expect(agentsAfterRestart[0].provider).toBe('codex')
    expect(agentsAfterRestart[0].workspacePath).toBe('/home/joao/Documents/Orchbot')
    expect(agentsAfterRestart[0].instructions).toBe('Instruções persistentes de teste')

    // Verifica que a thread inicial persiste
    const threads = session2.listThreads(createdAgent.id)
    expect(threads.length).toBe(1)
    expect(threads[0].title).toBe('Conversa Inicial')

    session2.close()

    // Limpeza
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath)
    if (fs.existsSync(`${testDbPath}-wal`)) fs.unlinkSync(`${testDbPath}-wal`)
    if (fs.existsSync(`${testDbPath}-shm`)) fs.unlinkSync(`${testDbPath}-shm`)
    if (fs.existsSync(testDbDir)) fs.rmdirSync(testDbDir)
  })
})
