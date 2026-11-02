import { describe, expect, it } from 'vitest'
import { ClaudeAdapter } from '../src/backend/providers/claude-adapter'
import { CodexAdapter } from '../src/backend/providers/codex-adapter'
import { ProviderRegistry } from '../src/backend/providers/registry'

describe('Provider Registry & Adapters (Codex and Claude)', () => {
  it('deve registrar ambos os adaptadores (Codex e Claude)', () => {
    const registry = new ProviderRegistry()
    const codex = registry.getAdapter('codex')
    const claude = registry.getAdapter('claude')

    expect(codex).toBeInstanceOf(CodexAdapter)
    expect(codex.id).toBe('codex')
    expect(codex.name).toContain('Codex')

    expect(claude).toBeInstanceOf(ClaudeAdapter)
    expect(claude.id).toBe('claude')
    expect(claude.name).toContain('Claude')
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
