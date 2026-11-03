import type { ProviderInfo, SupportedProvider } from '../../shared/types'
import { AcpAdapter } from './acp-adapter'
import { AntigravityAdapter } from './antigravity-adapter'
import { ClaudeAdapter } from './claude-adapter'
import { CodexAdapter } from './codex-adapter'
import { CopilotAdapter } from './copilot-adapter'
import { GeminiAdapter } from './gemini-adapter'
import { GrokAdapter } from './grok-adapter'
import { KimiAdapter } from './kimi-adapter'
import { MuseAdapter } from './muse-adapter'
import { OpenCodeAdapter } from './opencode-adapter'
import { PiAdapter } from './pi-adapter'
import type { ActiveExecution, ProviderAdapter, ProviderRuntimeConfig } from './types'

export class ProviderRegistry {
  private adapters = new Map<SupportedProvider, ProviderAdapter>()
  private activeExecutions = new Map<string, ActiveExecution>()

  constructor() {
    const all: ProviderAdapter[] = [
      new CodexAdapter(),
      new ClaudeAdapter(),
      new GrokAdapter(),
      new GeminiAdapter(),
      new MuseAdapter(),
      new AntigravityAdapter(),
      new OpenCodeAdapter(),
      new CopilotAdapter(),
      new PiAdapter(),
      new KimiAdapter(),
      new AcpAdapter(),
    ]
    for (const adapter of all) this.adapters.set(adapter.id, adapter)
  }

  public listAdapters(): ProviderAdapter[] {
    return [...this.adapters.values()]
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

  public unregisterAdapter(id: SupportedProvider): void {
    this.adapters.delete(id)
  }

  public async checkAllAvailability(
    configs?: Partial<Record<SupportedProvider, ProviderRuntimeConfig>>,
  ): Promise<Record<SupportedProvider, ProviderInfo>> {
    const entries = await Promise.all(
      [...this.adapters.keys()].map(async (id) => {
        const info = await this.getAdapter(id).checkAvailability(configs?.[id])
        return [id, info] as const
      }),
    )
    return Object.fromEntries(entries) as Record<SupportedProvider, ProviderInfo>
  }

  public registerActiveExecution(threadId: string, execution: ActiveExecution): void {
    this.activeExecutions.set(threadId, execution)
  }

  public removeActiveExecution(threadId: string): void {
    this.activeExecutions.delete(threadId)
  }

  public interruptAll(): void {
    for (const execution of this.activeExecutions.values()) execution.interrupt()
    this.activeExecutions.clear()
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
