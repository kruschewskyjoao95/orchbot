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

export class PiAdapter implements ProviderAdapter {
  public readonly id: SupportedProvider = 'pi'
  public readonly name = 'Pi'

  public async checkAvailability(config?: ProviderRuntimeConfig): Promise<ProviderInfo> {
    return checkCliAvailability('pi', config)
  }

  public executeTurn(
    prompt: string,
    options: ExecutionOptions,
    callbacks: ExecutionCallbacks,
  ): ActiveExecution {
    return runStreamingCli(
      {
        cliCommand: 'pi',
        label: 'pi',
        envKeys: ['PI_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY'],
        mode: 'plain',
        buildArgs: (p, opts) => {
          // CLI real: pi --print [--model <pattern>] <mensagem>
          const args = ['--print']
          if (opts.model) args.push('--model', opts.model)
          if (opts.providerConfig?.effort) args.push('--thinking', opts.providerConfig.effort)
          if (opts.instructions) args.push('--append-system-prompt', opts.instructions)
          args.push(p)
          return args
        },
      },
      prompt,
      options,
      callbacks,
    )
  }
}
