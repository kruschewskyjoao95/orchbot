import type { ProviderInfo, SupportedProvider } from '../../shared/types'
import { ClaudeAdapter } from './claude-adapter'
import { CodexAdapter } from './codex-adapter'
import { GrokAdapter } from './grok-adapter'
import { MuseAdapter } from './muse-adapter'
import type { ActiveExecution, ProviderAdapter } from './types'

export class ProviderRegistry {
  private adapters = new Map<SupportedProvider, ProviderAdapter>()
  private activeExecutions = new Map<string, ActiveExecution>()

  constructor() {
    const codex = new CodexAdapter()
    const claude = new ClaudeAdapter()
    const grok = new GrokAdapter()
    const muse = new MuseAdapter()

    this.adapters.set(codex.id, codex)
    this.adapters.set(claude.id, claude)
    this.adapters.set(grok.id, grok)
    this.adapters.set(muse.id, muse)
  }

  public getAdapter(id: SupportedProvider): ProviderAdapter {
    const adapter = this.adapters.get(id)
    if (!adapter) {
      throw new Error(`Provedor "${id}" não encontrado`)
    }
    return adapter
  }

  public registerAdapter(adapter: ProviderAdapter): void {
    this.adapters.set(adapter.id, adapter)
  }

  public async checkAllAvailability(): Promise<Record<SupportedProvider, ProviderInfo>> {
    const [codex, claude, grok, muse] = await Promise.all([
      this.getAdapter('codex').checkAvailability(),
      this.getAdapter('claude').checkAvailability(),
      this.getAdapter('grok').checkAvailability(),
      this.getAdapter('muse').checkAvailability(),
    ])

    return {
      codex,
      claude,
      grok,
      muse,
    }
  }

  public registerActiveExecution(threadId: string, execution: ActiveExecution): void {
    this.activeExecutions.set(threadId, execution)
  }

  public removeActiveExecution(threadId: string): void {
    this.activeExecutions.delete(threadId)
  }

  public interruptThread(threadId: string): boolean {
    const active = this.activeExecutions.get(threadId)
    if (active) {
      active.interrupt()
      this.activeExecutions.delete(threadId)
      return true
    }
    return false
  }
}
