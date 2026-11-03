import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProviderRegistry } from '../src/backend/providers/registry'
import type { ProviderAdapter } from '../src/backend/providers/types'
import { QueueManager } from '../src/backend/queue/queue-manager'
import { OrchbotDatabase } from '../src/backend/storage/db'
import { type SupportedProvider, effectiveCapabilities } from '../src/shared/types'

describe('Agents — padrões do computador e override por robô', () => {
  let tmpDir: string
  let db: OrchbotDatabase

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'orchbot-caps-'))
    db = new OrchbotDatabase(path.join(tmpDir, 'test.db'))
  })

  afterEach(() => {
    db.close()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('padrões começam desligados (scripts/novos chats/plano) e orientar em fila', () => {
    const s = db.getSettings()
    expect(s.defaultLocalScripts).toBe(false)
    expect(s.defaultStartsNewChats).toBe(false)
    expect(s.defaultShowPlanBeforeLongTasks).toBe(false)
    expect(s.defaultSteerMode).toBe('fila')
  })

  it('override do robô vence o padrão e voltar ao padrão limpa o override', () => {
    db.updateSettings({ defaultLocalScripts: false, defaultSteerMode: 'fila' })
    const agent = db.createAgent({
      name: 'Scripts',
      provider: 'codex',
      model: 'm',
      workspacePath: tmpDir,
      localScripts: true,
    })
    expect(effectiveCapabilities(agent, db.getSettings()).localScripts).toBe(true)
    expect(effectiveCapabilities(agent, db.getSettings()).steerMode).toBe('fila')

    const back = db.updateAgent({ id: agent.id, localScripts: null, steerMode: 'imediato' })
    expect(back.localScripts).toBeUndefined()
    expect(effectiveCapabilities(back, db.getSettings()).localScripts).toBe(false)
    expect(effectiveCapabilities(back, db.getSettings()).steerMode).toBe('imediato')
  })

  it('robô com novos chats + plano recebe as instruções e abre o chat sozinho', async () => {
    const agent = db.createAgent({
      name: 'Organizador',
      provider: 'codex',
      model: 'fake',
      workspacePath: tmpDir,
      startsNewChats: true,
      showPlanBeforeLongTasks: true,
    })

    const seen: string[] = []
    const adapter: ProviderAdapter = {
      id: 'codex' as SupportedProvider,
      name: 'fake',
      checkAvailability: async () => ({ available: true }),
      executeTurn: (prompt, options, callbacks) => {
        seen.push(options.instructions ?? '')
        const text = prompt.includes('acompanhar preços')
          ? 'Monitorando preços a partir de agora.'
          : 'Vou organizar.\n[[NOVO-CHAT:Preços]]\nacompanhar preços semanalmente\n[[/NOVO-CHAT]]'
        setTimeout(() => callbacks.onDone(text), 5)
        return { interrupt: () => {} }
      },
    }
    const registry = new ProviderRegistry()
    registry.registerAdapter(adapter)
    const queue = new QueueManager(db, registry, {})
    const thread = db.listThreads(agent.id)[0]
    if (!thread) throw new Error('thread ausente')
    queue.enqueue(agent.id, thread.id, 'organize meus tópicos')

    await vi.waitFor(
      () => {
        const threads = db.listThreads(agent.id)
        expect(threads.some((th) => th.title === 'Preços')).toBe(true)
      },
      { timeout: 8000, interval: 50 },
    )
    expect(seen.join('\n')).toContain('[PLANO ANTES DE TAREFAS LONGAS]')
    expect(seen.join('\n')).toContain('[SCRIPTS LOCAIS] Scripts locais estão desligados')
    const messages = db.listMessages(thread.id)
    expect(messages.some((m) => m.text.includes('Novo chat iniciado'))).toBe(true)
    expect(messages.some((m) => m.role === 'assistant' && m.text.includes('[[NOVO-CHAT'))).toBe(
      false,
    )
    queue.close()
  })
})
