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

export class MuseAdapter implements ProviderAdapter {
  public readonly id: SupportedProvider = 'muse'
  public readonly name = 'Muse Code'

  public async checkAvailability(config?: ProviderRuntimeConfig): Promise<ProviderInfo> {
    return checkCliAvailability('muse', config)
  }

  public executeTurn(
    prompt: string,
    options: ExecutionOptions,
    callbacks: ExecutionCallbacks,
  ): ActiveExecution {
    return runStreamingCli(
      {
        cliCommand: 'muse',
        label: 'muse',
        envKeys: ['MUSE_API_KEY', 'MUSE_TOKEN'],
        mode: 'lines-json',
        buildArgs: (p, opts) => {
          // CLI real: muse exec --json --model <id> --workspace <path> [--reasoning-effort] [--base-url]
          const args = ['exec', '--json']
          if (opts.model) args.push('--model', opts.model)
          if (opts.workspacePath) args.push('--workspace', opts.workspacePath)
          if (opts.providerConfig?.effort)
            args.push('--reasoning-effort', opts.providerConfig.effort)
          if (opts.providerConfig?.endpoint) args.push('--base-url', opts.providerConfig.endpoint)
          args.push(withInstructions(p, opts.instructions))
          return args
        },
      },
      prompt,
      options,
      callbacks,
    )
  }
}
