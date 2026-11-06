import fs from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { ProviderInfo, ProviderModelCatalog, SupportedProvider } from '../../shared/types'
import { claudeMcp } from '../mcp/mcp-launch'
import { getCatalogEntry } from './catalog'
import { checkCliAvailability } from './cli-utils'
import { probeModelCatalog } from './model-discovery'
import { runSessionCli } from './session-cli'
import type {
  ActiveExecution,
  ExecutionCallbacks,
  ExecutionOptions,
  ProviderAdapter,
  ProviderRuntimeConfig,
} from './types'

export class ClaudeAdapter implements ProviderAdapter {
  public readonly id: SupportedProvider = 'claude'
  public readonly name = 'Claude Code (Anthropic)'
  public readonly supportsSessionResume = true

  public async checkAvailability(config?: ProviderRuntimeConfig): Promise<ProviderInfo> {
    return checkCliAvailability('claude', config)
  }

  public async discoverModels(config?: ProviderRuntimeConfig): Promise<string[]> {
    return (await this.discoverModelCatalog(config)).models.map((model) => model.id)
  }

  public async discoverModelCatalog(config?: ProviderRuntimeConfig): Promise<ProviderModelCatalog> {
    const models = await probeModelCatalog('claude', config)
    return models.length
      ? { models, source: 'cli' }
      : { models: getCatalogEntry('claude').models.map((id) => ({ id })), source: 'catalog' }
  }

  public executeTurn(
    prompt: string,
    options: ExecutionOptions,
    callbacks: ExecutionCallbacks,
  ): ActiveExecution {
    const args = ['-p', '--verbose', '--output-format=stream-json', '--include-partial-messages']
    if (options.resumeSessionId) args.push('--resume', options.resumeSessionId)
    if (options.model) args.push('--model', options.model)
    if (options.providerConfig?.effort) args.push('--effort', options.providerConfig.effort)
    // Instruções em arquivo e prompt por stdin: o argv tem limite de 128 KB por argumento (E2BIG).
    let instructionsDir: string | undefined
    if (options.instructions && !options.providerConfig?.docker) {
      try {
        instructionsDir = fs.mkdtempSync(path.join(tmpdir(), 'orchbot-claude-'))
        const file = path.join(instructionsDir, 'instructions.md')
        fs.writeFileSync(file, options.instructions, { mode: 0o600 })
        args.push('--append-system-prompt-file', file)
      } catch {
        instructionsDir = undefined
        args.push('--append-system-prompt', options.instructions)
      }
    }
    const cleanup = () => {
      if (instructionsDir) fs.rmSync(instructionsDir, { recursive: true, force: true })
    }
    const done: ExecutionCallbacks = {
      ...callbacks,
      onDone: (text) => {
        cleanup()
        callbacks.onDone(text)
      },
      onError: (error) => {
        cleanup()
        callbacks.onError(error)
      },
      onInterrupted: () => {
        cleanup()
        callbacks.onInterrupted?.()
      },
    }
    for (const dir of options.extraDirs ?? []) args.push('--add-dir', dir)
    const servers = options.providerConfig?.mcpServers
    if (servers) args.push(...claudeMcp(servers).args)
    if (options.providerConfig?.docker && !options.permission)
      args.push('--dangerously-skip-permissions')
    const effectivePrompt =
      options.providerConfig?.docker && options.instructions
        ? `[Instruções do Sistema: ${options.instructions}]\n\n${prompt}`
        : prompt
    if (options.permission) {
      // O CLI pergunta ao host por stdin/stdout; manual ignora o modo padrão da conta (ex.: auto).
      args.push(
        '--input-format',
        'stream-json',
        '--permission-prompt-tool',
        'stdio',
        '--permission-mode',
        'manual',
      )
      return runSessionCli('claude', args, options, done, effectivePrompt)
    }
    return runSessionCli('claude', args, options, done, undefined, effectivePrompt)
  }
}
