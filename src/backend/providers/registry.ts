import type { ProviderInfo, SupportedProvider } from '../../shared/types'
import { ClaudeAdapter } from './claude-adapter'
import { CodexAdapter } from './codex-adapter'
import type { ActiveExecution, ProviderAdapter } from './types'

export class ProviderRegistry {
  private adapters = new Map<SupportedProvider, ProviderAdapter>()
  private activeExecutions = new Map<string, ActiveExecution>()

  constructor() {
    const codex = new CodexAdapter()
    const claude = new ClaudeAdapter()

    this.adapters.set(codex.id, codex)
    this.adapters.set(claude.id, claude)
  }

  public getAdapter(id: SupportedProvider): ProviderAdapter {
    const adapter = this.adapters.get(id)
    if (!adapter) {
      throw new Error(`Provedor "${id}" não encontrado`)
    }
    return adapter
  }

  public async checkAllAvailability(): Promise<Record<SupportedProvider, ProviderInfo>> {
    const codex = await this.getAdapter('codex').checkAvailability()
    const claude = await this.getAdapter('claude').checkAvailability()

    return {
      codex,
      claude,
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
