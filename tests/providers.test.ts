import { describe, expect, it } from 'vitest'
import { ClaudeAdapter } from '../src/backend/providers/claude-adapter'
import { CodexAdapter } from '../src/backend/providers/codex-adapter'
import { GrokAdapter } from '../src/backend/providers/grok-adapter'
import { MuseAdapter } from '../src/backend/providers/muse-adapter'
import { ProviderRegistry } from '../src/backend/providers/registry'

describe('Provider Registry & Adapters (Codex, Claude, Grok, Muse)', () => {
  it('deve registrar todos os 4 adaptadores', () => {
    const registry = new ProviderRegistry()
    const codex = registry.getAdapter('codex')
    const claude = registry.getAdapter('claude')
    const grok = registry.getAdapter('grok')
    const muse = registry.getAdapter('muse')

    expect(codex).toBeInstanceOf(CodexAdapter)
    expect(claude).toBeInstanceOf(ClaudeAdapter)
    expect(grok).toBeInstanceOf(GrokAdapter)
    expect(muse).toBeInstanceOf(MuseAdapter)
  })

  it('deve verificar a disponibilidade do Codex no sistema', async () => {
    const adapter = new CodexAdapter()
    const status = await adapter.checkAvailability()

    expect(status).toBeDefined()
    expect(typeof status.available).toBe('boolean')
    if (status.available) {
      expect(status.version).toContain('codex')
    }
  })

  it('deve verificar a disponibilidade do Claude no sistema', async () => {
    const adapter = new ClaudeAdapter()
    const status = await adapter.checkAvailability()

    expect(status).toBeDefined()
    expect(typeof status.available).toBe('boolean')
    if (status.available) {
      expect(status.version).toBeDefined()
    }
  })

  it('deve retornar status agrupado de todos os provedores', async () => {
    const registry = new ProviderRegistry()
    const all = await registry.checkAllAvailability()

    expect(all.codex).toBeDefined()
    expect(all.claude).toBeDefined()
    expect(typeof all.codex.available).toBe('boolean')
    expect(typeof all.claude.available).toBe('boolean')
  })

  it('deve permitir registrar e interromper execuções ativas', () => {
    const registry = new ProviderRegistry()
    let wasInterrupted = false

    registry.registerActiveExecution('thread-123', {
      interrupt: () => {
        wasInterrupted = true
      },
    })

    const interrupted = registry.interruptThread('thread-123')
    expect(interrupted).toBe(true)
    expect(wasInterrupted).toBe(true)

    // Interromper novamente deve retornar false (já removido)
    expect(registry.interruptThread('thread-123')).toBe(false)
  })
})
