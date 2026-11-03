import { readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { ProviderInfo, SupportedProvider } from '../../shared/types'
import { codexMcp } from '../mcp/mcp-launch'
import { getCatalogEntry } from './catalog'
import { checkCliAvailability } from './cli-utils'
import { runSessionCli } from './session-cli'
import type {
  ActiveExecution,
  ExecutionCallbacks,
  ExecutionOptions,
  ProviderAdapter,
  ProviderRuntimeConfig,
} from './types'

export class CodexAdapter implements ProviderAdapter {
  public readonly id: SupportedProvider = 'codex'
  public readonly name = 'Codex (OpenAI)'
  public readonly supportsSessionResume = true

  public async checkAvailability(config?: ProviderRuntimeConfig): Promise<ProviderInfo> {
    return checkCliAvailability('codex', config)
  }

  public async discoverModels(config?: ProviderRuntimeConfig): Promise<string[]> {
    // O próprio Codex mantém a lista de modelos da conta em models_cache.json.
    const home = process.env.CODEX_HOME || path.join(os.homedir(), '.codex')
    try {
      const data = JSON.parse(await readFile(path.join(home, 'models_cache.json'), 'utf8'))
      const slugs = (data.models as { slug: string; visibility?: string; priority?: number }[])
        .filter((m) => m.visibility === 'list')
        .sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99))
        .map((m) => m.slug)
      if (slugs.length > 0) return slugs
    } catch {}
    return [...getCatalogEntry('codex').models]
  }

  public executeTurn(
    prompt: string,
    options: ExecutionOptions,
    callbacks: ExecutionCallbacks,
  ): ActiveExecution {
    const args = options.resumeSessionId
      ? ['exec', 'resume', '--skip-git-repo-check', '--json']
      : ['exec', '--skip-git-repo-check', '--json']
    const servers = options.providerConfig?.mcpServers
    if (servers?.length) args.push(...codexMcp(servers).args)
    // exec resume has no -C flag; cwd sets the workspace for both commands.
    if (options.model) args.push('-m', options.model)
    const effectivePrompt = options.instructions
      ? `[Instruções do Sistema: ${options.instructions}]\n\n${prompt}`
      : prompt
    args.push('--', ...(options.resumeSessionId ? [options.resumeSessionId] : []), effectivePrompt)
    return runSessionCli('codex', args, options, callbacks)
  }
}
