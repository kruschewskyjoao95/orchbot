import { MCP_POLICY_MIN_VERSION, hasMcpRestriction } from '../../shared/authority'
import type { SupportedProvider } from '../../shared/types'
import { runCliProbe } from '../providers/cli-auth'
import { buildProviderEnv, resolveCliCommand } from '../providers/cli-utils'
import type { McpLaunchServer, ProviderRuntimeConfig } from '../providers/types'

export async function requireMcpPolicyVersion(
  provider: SupportedProvider,
  servers: McpLaunchServer[],
  config: ProviderRuntimeConfig,
): Promise<void> {
  if (!servers.some((s) => s.toolPolicy && hasMcpRestriction(s.toolPolicy))) return
  if (provider !== 'codex' && provider !== 'claude')
    throw new Error('Engine sem suporte a política MCP.')
  const minimum = MCP_POLICY_MIN_VERSION[provider]
  const probe = await runCliProbe(
    resolveCliCommand(provider, config.cliPath),
    ['--version'],
    buildProviderEnv(config),
  )
  const found =
    provider === 'codex'
      ? /^codex-cli (\d+)\.(\d+)\.(\d+)\s*$/m.exec(probe.stdout.trim())
      : /^(\d+)\.(\d+)\.(\d+) \(Claude Code\)\s*$/m.exec(probe.stdout.trim())
  const version = found?.slice(1).map(Number)
  const firstDifferent = version?.findIndex((part, i) => part !== minimum[i])
  if (
    probe.code !== 0 ||
    !version ||
    firstDifferent === undefined ||
    (firstDifferent >= 0 && version[firstDifferent] < minimum[firstDifferent])
  )
    throw new Error(
      `Não foi possível confirmar suporte ao filtro MCP. Requer ${provider} >= ${minimum.join('.')}. Atualize o CLI; o turno foi bloqueado.`,
    )
}
