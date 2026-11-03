import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { AcpAdapter } from '../src/backend/providers/acp-adapter'
import { AntigravityAdapter } from '../src/backend/providers/antigravity-adapter'
import { PROVIDER_CATALOG, listCatalog } from '../src/backend/providers/catalog'
import { ClaudeAdapter } from '../src/backend/providers/claude-adapter'
import { CodexAdapter } from '../src/backend/providers/codex-adapter'
import { CopilotAdapter } from '../src/backend/providers/copilot-adapter'
import { GrokAdapter } from '../src/backend/providers/grok-adapter'
import { KimiAdapter } from '../src/backend/providers/kimi-adapter'
import { MuseAdapter } from '../src/backend/providers/muse-adapter'
import { OpenCodeAdapter } from '../src/backend/providers/opencode-adapter'
import { PiAdapter } from '../src/backend/providers/pi-adapter'
import { ProviderRegistry } from '../src/backend/providers/registry'
import { SUPPORTED_PROVIDERS } from '../src/shared/types'

describe('Provider Registry & Adapters', () => {
  it('deve registrar todos os adaptadores', () => {
    const registry = new ProviderRegistry()
    expect(registry.getAdapter('codex')).toBeInstanceOf(CodexAdapter)
    expect(registry.getAdapter('claude')).toBeInstanceOf(ClaudeAdapter)
    expect(registry.getAdapter('grok')).toBeInstanceOf(GrokAdapter)
    expect(registry.getAdapter('muse')).toBeInstanceOf(MuseAdapter)
    expect(registry.getAdapter('antigravity')).toBeInstanceOf(AntigravityAdapter)
    expect(registry.getAdapter('opencode')).toBeInstanceOf(OpenCodeAdapter)
    expect(registry.getAdapter('copilot')).toBeInstanceOf(CopilotAdapter)
    expect(registry.getAdapter('pi')).toBeInstanceOf(PiAdapter)
    expect(registry.getAdapter('kimi')).toBeInstanceOf(KimiAdapter)
    expect(registry.getAdapter('acp')).toBeInstanceOf(AcpAdapter)
    expect(registry.listAdapters().length).toBe(SUPPORTED_PROVIDERS.length)
  })

  it('catálogo deve cobrir todos os provedores suportados com CLI e modelo padrão', () => {
    const catalog = listCatalog()
    expect(catalog.length).toBe(SUPPORTED_PROVIDERS.length)
    for (const entry of catalog) {
      expect(entry.cliCommand.length).toBeGreaterThan(0)
      expect(entry.defaultModel.length).toBeGreaterThan(0)
      expect(entry.models).toContain(entry.defaultModel)
      expect(entry.installHint.length).toBeGreaterThan(0)
      expect(PROVIDER_CATALOG[entry.providerId]).toBe(entry)
    }
    expect(PROVIDER_CATALOG.antigravity.supportsModelDiscovery).toBe(true)
    expect(PROVIDER_CATALOG.opencode.supportsModelDiscovery).toBe(true)
  })

  it('antigravity usa o transporte ACP: descobre modelos pelo session/new', async () => {
    const fixture = fileURLToPath(new URL('./fixtures/acp-agent.mjs', import.meta.url))
    process.env.ORCHBOT_NO_RTTIME_GUARD = '1'
    try {
      const models = await new AntigravityAdapter().discoverModels({
        cliPath: process.execPath,
        cliArgs: [fixture, 'normal'],
      })
      expect(models).toEqual(['auto', 'model-a', 'model-b'])
    } finally {
      Reflect.deleteProperty(process.env, 'ORCHBOT_NO_RTTIME_GUARD')
    }
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
  }, 20000)

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
