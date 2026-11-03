import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { ProviderInfo, SupportedProvider } from '../../shared/types'
import { getCatalogEntry } from './catalog'
import { checkCliAvailability, resolveCliCommand } from './cli-utils'
import { runStreamingCli, withInstructions } from './runner'
import type {
  ActiveExecution,
  ExecutionCallbacks,
  ExecutionOptions,
  ProviderAdapter,
  ProviderRuntimeConfig,
} from './types'

const execFileAsync = promisify(execFile)

export class OpenCodeAdapter implements ProviderAdapter {
  public readonly id: SupportedProvider = 'opencode'
  public readonly name = 'OpenCode'

  public async checkAvailability(config?: ProviderRuntimeConfig): Promise<ProviderInfo> {
    return checkCliAvailability('opencode', config)
  }

  public async discoverModels(config?: ProviderRuntimeConfig): Promise<string[]> {
    const entry = getCatalogEntry('opencode')
    const command = resolveCliCommand(entry.cliCommand, config?.cliPath)
    try {
      const { stdout } = await execFileAsync(command, ['models'], { timeout: 20000 })
      const models = stdout
        .split('\n')
        .map((l) => l.trim())
        .filter((id) => id.length > 0 && id.includes('/'))
      return models.length > 0 ? models : [...entry.models]
    } catch {
      return [...entry.models]
    }
  }

  public executeTurn(
    prompt: string,
    options: ExecutionOptions,
    callbacks: ExecutionCallbacks,
  ): ActiveExecution {
    return runStreamingCli(
      {
        cliCommand: 'opencode',
        label: 'opencode',
        envKeys: ['OPENCODE_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY'],
        mode: 'lines-json',
        buildArgs: (p, opts) => {
          // CLI real: opencode run -m <provider/model> --format json <mensagem>
          const args = ['run', '--format', 'json']
          if (opts.model) args.push('-m', opts.model)
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
