import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expect, it, vi } from 'vitest'
import { CollaborationService } from '../src/backend/collaboration/collaboration-service'
import { OrchbotDatabase } from '../src/backend/storage/db'
import { testSecretStorage } from './secret-storage-fixture'

it('routing é opt-in, só usa membros do canal e publica a decisão sem trocar o dono', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orchbot-routing-'))
  const db = new OrchbotDatabase(':memory:', testSecretStorage)
  const enqueue = vi.fn()
  try {
    const make = (name: string, description: string) =>
      db.createAgent({ name, description, provider: 'codex', model: 'x', workspacePath: dir })
    const owner = make('Dono', 'planejamento organização')
    const qa = make('Ana', 'testes regressão')
    const outsider = make('Fora', 'banco sql')
    const service = new CollaborationService(db, { enqueue, cancelTask: () => true })
    const channel = service.createChannel({
      title: 'Trabalho',
      ownerAgentId: owner.id,
      memberIds: [qa.id],
    })
    service.post(channel.id, 'Revise os testes de regressão')
    expect(enqueue.mock.calls.at(-1)?.[0]).toBe(owner.id)
    db.updateSettings({ autoRouteChannels: true })
    service.post(channel.id, 'Revise os testes de regressão')
    expect(enqueue.mock.calls.at(-1)?.[0]).toBe(qa.id)
    expect(db.getChannel(channel.id)?.ownerAgentId).toBe(owner.id)
    expect(
      db
        .listChannelMessages(channel.id)
        .some((message) => message.kind === 'system' && message.text.includes('Ana')),
    ).toBe(true)
    service.post(channel.id, `@${outsider.name} banco sql`)
    expect(enqueue.mock.calls.at(-1)?.[0]).toBe(owner.id)
  } finally {
    db.close()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
