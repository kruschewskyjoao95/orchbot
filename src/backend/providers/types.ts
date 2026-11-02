import type { ProviderInfo, SupportedProvider } from '../../shared/types'

export interface ExecutionOptions {
  workspacePath: string
  model?: string
  instructions?: string
}

export interface ExecutionCallbacks {
  onChunk: (chunk: string, fullText: string) => void
  onError: (error: string) => void
  onDone: (fullText: string) => void
}

export interface ActiveExecution {
  interrupt: () => void
}

export interface ProviderAdapter {
  readonly id: SupportedProvider
  readonly name: string
  checkAvailability(): Promise<ProviderInfo>
  executeTurn(
    prompt: string,
    options: ExecutionOptions,
    callbacks: ExecutionCallbacks,
  ): ActiveExecution
}
