import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { OrchbotDatabase } from '../src/backend/storage/db'
import { COWORKER_TEMPLATES, templateInstructions } from '../src/renderer/src/orchestration-ui'
import { testSecretStorage } from './secret-storage-fixture'

describe('pasta do agente no disco', () => {
  let db: OrchbotDatabase
  let dir: string
  afterEach(() => {
    db?.close()
    if (dir) fs.rmSync(dir, { recursive: true, force: true })
  })

  it('espelha instruções e memória em markdown e acompanha as mudanças', () => {
    db = new OrchbotDatabase(':memory:', testSecretStorage)
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-folder-'))
    const agent = db.createAgent({
      name: 'Ana',
      role: 'worker',
      provider: 'codex',
      model: 'gpt',
      instructions: 'seja breve',
      workspacePath: dir,
    })
    const soul = path.join(dir, '.orchbot', 'agent', 'SOUL.md')
    const memory = path.join(dir, '.orchbot', 'agent', 'MEMORY.md')
    expect(fs.readFileSync(soul, 'utf8')).toContain('seja breve')
    expect(fs.readFileSync(memory, 'utf8')).toContain('(vazia)')

    db.addMemory(agent.id, 'gosta de café')
    expect(fs.readFileSync(memory, 'utf8')).toContain('gosta de café')
    const [saved] = db.listMemories(agent.id)
    db.deleteMemory(agent.id, saved.id)
    expect(fs.readFileSync(memory, 'utf8')).toContain('(vazia)')

    db.updateAgent({ id: agent.id, instructions: 'seja longo' })
    expect(fs.readFileSync(soul, 'utf8')).toContain('seja longo')
  })

  it('não cria workspace que não existe', () => {
    db = new OrchbotDatabase(':memory:', testSecretStorage)
    dir = path.join(os.tmpdir(), `agent-folder-missing-${Date.now()}`)
    db.createAgent({
      name: 'Bia',
      role: 'worker',
      provider: 'codex',
      model: 'gpt',
      workspacePath: dir,
    })
    expect(fs.existsSync(dir)).toBe(false)
    dir = ''
  })
})

describe('configuração inicial dos templates', () => {
  it('cargos de negócio perguntam uma vez e gravam na memória; os técnicos não', () => {
    const secretary = COWORKER_TEMPLATES.find((t) => t.id === 'executive-assistant')
    const text = templateInstructions(secretary as NonNullable<typeof secretary>)
    expect(text).toContain('[[MEMORY:remember]]')
    expect(text).toContain('nunca mais pergunte')
    const dev = COWORKER_TEMPLATES.find((t) => t.id === 'software-architect')
    expect(templateInstructions(dev as NonNullable<typeof dev>)).toBe(dev?.instructions)
  })
})
