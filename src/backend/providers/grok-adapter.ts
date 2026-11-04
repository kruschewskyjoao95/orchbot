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

export class GrokAdapter implements ProviderAdapter {
  public readonly id: SupportedProvider = 'grok'
  public readonly name = 'Grok (xAI)'

  public async checkAvailability(config?: ProviderRuntimeConfig): Promise<ProviderInfo> {
    return checkCliAvailability('grok', config)
  }

  public async discoverModels(config?: ProviderRuntimeConfig): Promise<string[]> {
    const entry = getCatalogEntry('grok')
    try {
      const { stdout } = await promisify(execFile)(
        resolveCliCommand(entry.cliCommand, config?.cliPath),
        ['models'],
        { timeout: 20000 },
      )
      const models = [...stdout.matchAll(/^\s*[*-]\s+(\S+)/gm)].map((m) => m[1])
      if (models.length > 0) return models
    } catch {}
    return [...entry.models]
  }

  public executeTurn(
    prompt: string,
    options: ExecutionOptions,
    callbacks: ExecutionCallbacks,
  ): ActiveExecution {
    return runStreamingCli(
      {
        cliCommand: 'grok',
        label: 'grok',
        envKeys: ['GROK_API_KEY', 'XAI_API_KEY'],
        mode: 'lines-json',
        buildArgs: (p, opts) => {
          // CLI real: grok -p/--single <prompt> -m <model> --output-format streaming-json
          const args = [
            '--single',
            withInstructions(p, opts.instructions),
            '--output-format',
            'streaming-json',
          ]
          if (opts.model) args.push('-m', opts.model)
          for (const dir of opts.extraDirs ?? []) args.push('--add-dir', dir)
          if (opts.providerConfig?.effort)
            args.push('--reasoning-effort', opts.providerConfig.effort)
          return args
        },
      },
      prompt,
      options,
      callbacks,
    )
  }
}
