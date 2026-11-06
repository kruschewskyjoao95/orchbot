import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { OrchbotDatabase } from '../src/backend/storage/db'
import { testSecretStorage } from './secret-storage-fixture'

describe('contatos na barra lateral', () => {
  let db: OrchbotDatabase

  beforeEach(() => {
    db = new OrchbotDatabase(':memory:', testSecretStorage)
  })

  afterEach(() => {
    db.close()
  })

  const mk = (name: string) =>
    db.createAgent({ name, provider: 'codex', model: 'gpt', workspacePath: '/tmp/sidebar' })

  it('lista a última mensagem e fixa o contato no topo', () => {
    const ana = mk('Ana')
    const beto = mk('Beto')
    db.addMessage(db.listThreads(ana.id)[0].id, 'assistant', 'Rascunho pronto.')
    db.updateAgent({ id: ana.id, pinned: true })

    const listed = db.listAgents()
    expect(listed.map((agent) => agent.name)).toEqual(['Ana', 'Beto'])
    expect(listed.find((agent) => agent.id === ana.id)).toMatchObject({
      lastMessage: 'Rascunho pronto.',
      unread: true,
      pinned: true,
    })
  })

  it('mensagem do usuário não marca não lido; marcar lido limpa', () => {
    const ana = mk('Ana')
    const thread = db.listThreads(ana.id)[0].id
    db.addMessage(thread, 'user', 'oi')
    expect(db.getAgent(ana.id)?.unread).toBe(false)
    db.addMessage(thread, 'assistant', 'olá')
    expect(db.getAgent(ana.id)?.unread).toBe(true)
    db.updateAgent({ id: ana.id, unread: false })
    expect(db.getAgent(ana.id)?.unread).toBe(false)
  })

  it('duplica instruções e skills, sem copiar MCP', () => {
    const ana = mk('Ana')
    db.updateAgent({ id: ana.id, instructions: 'Fale curto.' })
    db.setAgentSkills(ana.id, ['revisao'])
    const server = db.saveMcpServer({ name: 'gh', transport: 'stdio', command: 'npx' })
    db.setAgentMcp(ana.id, [server.id])

    const copy = db.duplicateAgent(ana.id)
    expect(copy.id).not.toBe(ana.id)
    expect(copy.name).toBe('Ana (cópia)')
    expect(copy.instructions).toBe('Fale curto.')
    expect(db.listAgentSkills(copy.id)).toEqual(['revisao'])
    expect(db.listAgentMcp(copy.id)).toEqual([])
    expect(db.listAgentMcp(ana.id)).toEqual([server.id])
  })
})
