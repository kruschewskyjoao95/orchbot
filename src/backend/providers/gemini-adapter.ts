import type { ProviderInfo, SupportedProvider } from '../../shared/types'
import { checkCliAvailability } from './cli-utils'
import { runStreamingCli, withInstructions } from './runner'
import type {
  ActiveExecution,
  ExecutionCallbacks,
  ExecutionOptions,
  ProviderAdapter,
  ProviderRuntimeConfig,
} from './types'

export class GeminiAdapter implements ProviderAdapter {
  public readonly id: SupportedProvider = 'gemini'
  public readonly name = 'Google Gemini'

  public async checkAvailability(config?: ProviderRuntimeConfig): Promise<ProviderInfo> {
    return checkCliAvailability('gemini', config)
  }

  public executeTurn(
    prompt: string,
    options: ExecutionOptions,
    callbacks: ExecutionCallbacks,
  ): ActiveExecution {
    return runStreamingCli(
      {
        cliCommand: 'gemini',
        label: 'gemini',
        envKeys: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
        mode: 'plain',
        buildArgs: (p, opts) => {
          // Gemini CLI real: gemini -p <prompt> -m <model> (modo headless)
          const args = ['-p', withInstructions(p, opts.instructions)]
          if (opts.model) args.push('-m', opts.model)
          return args
        },
      },
      prompt,
      options,
      callbacks,
    )
  }
}
