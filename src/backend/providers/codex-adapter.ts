import { readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { ProviderInfo, ProviderModelCatalog, SupportedProvider } from '../../shared/types'
import { codexMcp } from '../mcp/mcp-launch'
import { getCatalogEntry } from './catalog'
import { checkCliAvailability } from './cli-utils'
import { parseProviderModels, probeModelCatalog } from './model-discovery'
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
    return (await this.discoverModelCatalog(config)).models.map((model) => model.id)
  }

  public async discoverModelCatalog(config?: ProviderRuntimeConfig): Promise<ProviderModelCatalog> {
    const live = await probeModelCatalog('codex', config)
    if (live.length) return { models: live, source: 'cli' }
    const home =
      config?.cliProfile?.directory || process.env.CODEX_HOME || path.join(os.homedir(), '.codex')
    try {
      const data = JSON.parse(await readFile(path.join(home, 'models_cache.json'), 'utf8'))
      const rows = Array.isArray(data.models)
        ? data.models.filter((m: { visibility?: string }) => m.visibility === 'list')
        : []
      const models = parseProviderModels(rows)
      if (models.length) return { models, source: 'cache' }
    } catch {}
    return { models: getCatalogEntry('codex').models.map((id) => ({ id })), source: 'catalog' }
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
    const effort = options.providerConfig?.effort
    if (effort) args.push('-c', `model_reasoning_effort="${effort}"`)
    // exec não pergunta nada: no cauteloso o terminal fica só leitura até o turno aprovado.
    // -c porque exec resume não aceita -s.
    if (options.permission)
      args.push(
        '-c',
        `sandbox_mode="${options.permission === 'approved' ? 'workspace-write' : 'read-only'}"`,
      )
    // exec resume não aceita --add-dir; a raiz gravável via -c vale nos dois.
    if (options.extraDirs?.length)
      args.push('-c', `sandbox_workspace_write.writable_roots=${JSON.stringify(options.extraDirs)}`)
    const effectivePrompt = options.instructions
      ? `[Instruções do Sistema: ${options.instructions}]\n\n${prompt}`
      : prompt
    // `-`: o prompt vem por stdin (instruções + prompt podem passar de 128 KB, o limite do argv).
    args.push('--', ...(options.resumeSessionId ? [options.resumeSessionId] : []), '-')
    return runSessionCli('codex', args, options, callbacks, undefined, effectivePrompt)
  }
}
