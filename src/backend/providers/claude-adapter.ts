import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import type { ProviderInfo, SupportedProvider } from '../../shared/types'
import { claudeMcp } from '../mcp/mcp-launch'
import { getCatalogEntry } from './catalog'
import { buildProviderEnv, checkCliAvailability, resolveCliCommand } from './cli-utils'
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
    // O Claude Code responde à requisição "initialize" do protocolo stream-json com os modelos da conta
    // (mesma fonte do supportedModels() do Agent SDK); funciona com assinatura, sem chave de API.
    const entry = getCatalogEntry('claude')
    const fromCli = await new Promise<string[]>((resolve) => {
      const child = spawn(
        resolveCliCommand(entry.cliCommand, config?.cliPath),
        ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose'],
        { cwd: tmpdir(), env: buildProviderEnv(config), stdio: ['pipe', 'pipe', 'ignore'] },
      )
      let buf = ''
      const done = (models: string[]) => {
        clearTimeout(timer)
        child.kill()
        resolve(models)
      }
      const timer = setTimeout(() => done([]), 20000)
      child.on('error', () => done([]))
      child.on('close', () => done([]))
      child.stdout.on('data', (chunk) => {
        buf += chunk
        for (const line of buf.split('\n')) {
          if (!line.includes('"control_response"')) continue
          try {
            const models = JSON.parse(line).response?.response?.models as
              | { value: string; resolvedModel?: string }[]
              | undefined
            return done([
              ...new Set((models ?? []).filter((m) => m.value !== 'default').map((m) => m.value)),
            ])
          } catch {}
        }
      })
      child.stdout.setEncoding('utf8')
      child.stdin.write(
        '{"request_id":"models","type":"control_request","request":{"subtype":"initialize"}}\n',
      )
    })
    return fromCli.length > 0 ? fromCli : [...entry.models]
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
    if (options.instructions) args.push('--append-system-prompt', options.instructions)
    const servers = options.providerConfig?.mcpServers
    if (servers?.length) args.push(...claudeMcp(servers).args)
    args.push('--', prompt)
    return runSessionCli('claude', args, options, callbacks)
  }
}
