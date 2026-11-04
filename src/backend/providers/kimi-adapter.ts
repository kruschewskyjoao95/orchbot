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

export class KimiAdapter implements ProviderAdapter {
  public readonly id: SupportedProvider = 'kimi'
  public readonly name = 'Kimi Code (Moonshot)'

  public async checkAvailability(config?: ProviderRuntimeConfig): Promise<ProviderInfo> {
    return checkCliAvailability('kimi', config)
  }

  public executeTurn(
    prompt: string,
    options: ExecutionOptions,
    callbacks: ExecutionCallbacks,
  ): ActiveExecution {
    return runStreamingCli(
      {
        cliCommand: 'kimi',
        label: 'kimi',
        envKeys: ['KIMI_API_KEY', 'MOONSHOT_API_KEY'],
        mode: 'lines-json',
        buildArgs: (p, opts) => {
          // CLI real: kimi -p <prompt> -m <modelo> --output-format stream-json
          const args = [
            '-p',
            withInstructions(p, opts.instructions),
            '--output-format',
            'stream-json',
          ]
          if (opts.model) args.push('-m', opts.model)
          for (const dir of opts.extraDirs ?? []) args.push('--add-dir', dir)
          return args
        },
      },
      prompt,
      options,
      callbacks,
    )
  }
}
