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

export class CopilotAdapter implements ProviderAdapter {
  public readonly id: SupportedProvider = 'copilot'
  public readonly name = 'GitHub Copilot'

  public async checkAvailability(config?: ProviderRuntimeConfig): Promise<ProviderInfo> {
    return checkCliAvailability('copilot', config)
  }

  public executeTurn(
    prompt: string,
    options: ExecutionOptions,
    callbacks: ExecutionCallbacks,
  ): ActiveExecution {
    return runStreamingCli(
      {
        cliCommand: 'copilot',
        label: 'copilot',
        envKeys: ['COPILOT_GITHUB_TOKEN', 'GH_TOKEN', 'GITHUB_TOKEN'],
        mode: 'plain',
        buildArgs: (p, opts) => {
          // CLI real: copilot -p <prompt> --model <id> --allow-all-tools (headless)
          const args = ['-p', withInstructions(p, opts.instructions), '--allow-all-tools']
          if (opts.model && opts.model !== 'auto') args.push('--model', opts.model)
          return args
        },
      },
      prompt,
      options,
      callbacks,
    )
  }
}
