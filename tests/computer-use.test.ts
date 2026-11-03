import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  parseComputerDirectives,
  stripComputerDirectives,
} from '../src/backend/computer/computer-protocol'
import { checkComputerUse } from '../src/backend/computer/computer-tools'
import { ProviderRegistry } from '../src/backend/providers/registry'
import type { ProviderAdapter } from '../src/backend/providers/types'
import { QueueManager } from '../src/backend/queue/queue-manager'
import { OrchbotDatabase } from '../src/backend/storage/db'
import { type SupportedProvider, effectiveCapabilities } from '../src/shared/types'

describe('Uso do computador — protocolo e status', () => {
  it('extrai comandos apps/screenshot/click/type e limpa o texto', () => {
    const text =
      'Vou olhar.\n[[COMPUTER:apps]] [[/COMPUTER]]\n[[COMPUTER:click]] 640, 420 [[/COMPUTER]]\n[[COMPUTER:type]] olá [[/COMPUTER]]'
    expect(parseComputerDirectives(text)).toEqual([
      { action: 'apps' },
      { action: 'click', x: 640, y: 420 },
      { action: 'type', target: 'olá' },
    ])
    expect(stripComputerDirectives(text)).toBe('Vou olhar.')
  })

  it('status responde com ferramentas detectadas sem quebrar', async () => {
    const status = await checkComputerUse()
    expect(typeof status.ready).toBe('boolean')
    expect(status.message.length).toBeGreaterThan(10)
    expect(status.platform).toBe(process.platform)
  })
})

describe('Robô usa o computador quando habilitado', () => {
  let tmpDir: string
  let db: OrchbotDatabase

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'orchbot-computer-'))
    db = new OrchbotDatabase(path.join(tmpDir, 'test.db'))
  })

  afterEach(() => {
    db.close()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('padrão desligado; robô habilitado lista apps e responde', async () => {
    db.updateSettings({ computerUseEnabled: false })
    const agent = db.createAgent({
      name: 'Desktop',
      provider: 'codex',
      model: 'fake',
      workspacePath: tmpDir,
      computerUse: true,
    })
    expect(effectiveCapabilities(agent, db.getSettings()).computerUse).toBe(true)

    const adapter: ProviderAdapter = {
      id: 'codex' as SupportedProvider,
      name: 'fake',
      checkAvailability: async () => ({ available: true }),
      executeTurn: (prompt, options, callbacks) => {
        if (prompt.includes('[RESULTADO DO COMPUTADOR]')) {
          expect(options.instructions).toContain('[USO DO COMPUTADOR]')
          setTimeout(() => callbacks.onDone('Você tem 2 janelas abertas.'), 5)
        } else {
          setTimeout(() => callbacks.onDone('Vou ver a tela.\n[[COMPUTER:apps]] [[/COMPUTER]]'), 5)
        }
        return { interrupt: () => {} }
      },
    }
    const registry = new ProviderRegistry()
    registry.registerAdapter(adapter)
    const queue = new QueueManager(db, registry, {})
    const calls: string[] = []
    queue.setComputerExecutor(async (_id, action) => {
      calls.push(action)
      return '- firefox: "Google" em 0,0 tamanho 800x600'
    })

    const thread = db.listThreads(agent.id)[0]
    if (!thread) throw new Error('thread ausente')
    queue.enqueue(agent.id, thread.id, 'o que está aberto aí?')

    await vi.waitFor(
      () => {
        const messages = db.listMessages(thread.id)
        expect(messages.some((m) => m.text.includes('2 janelas abertas'))).toBe(true)
      },
      { timeout: 8000, interval: 50 },
    )
    expect(calls).toEqual(['apps'])
    queue.close()
  })
})
