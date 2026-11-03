import fs from 'node:fs'
import path from 'node:path'
import type { ProviderInfo, SupportedProvider } from '../../shared/types'
import type { OrchbotDatabase } from '../storage/db'
import { getCatalogEntry } from './catalog'
import { managedBinPath } from './managed-cli'
import type { ProviderRuntimeConfig } from './types'

export function profileLoginHint(
  provider: SupportedProvider,
  command: string | undefined,
  directory: string,
): string {
  const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`
  const variable = provider === 'codex' ? 'CODEX_HOME' : 'CLAUDE_CONFIG_DIR'
  return `${variable}=${quote(directory)} ${quote(command || provider)} ${provider === 'codex' ? 'login' : 'auth login'}`
}

export function resolveAccountRuntime(
  db: OrchbotDatabase,
  providerId: SupportedProvider,
  accountId?: string,
) {
  const connection = db.getConnection(providerId)
  if (!connection || !connection.enabled)
    throw new Error('O provedor está desativado ou não existe.')
  const account = db.getProviderAccount(providerId, accountId)
  if (!account || !account.enabled)
    throw new Error(
      'A conta selecionada está desativada, não existe ou nenhuma conta está habilitada.',
    )
  const apiKey = db.getProviderAccountApiKey(providerId, account.id)
  if (account.authMode === 'api_key' && !apiKey)
    throw new Error(
      'A conta selecionada está sem API key. Cadastre a chave ou escolha outra conta.',
    )
  if (providerId === 'acp' && apiKey && !connection.apiKeyEnv)
    throw new Error('Configure a variável de ambiente da API key na conexão ACP.')
  let cliProfile: ProviderRuntimeConfig['cliProfile']
  if (!account.isDefault && (providerId === 'codex' || providerId === 'claude')) {
    const root = db.getAccountProfilesDirectory()
    const directory =
      account.authMode === 'cli_profile'
        ? account.profilePath
        : root
          ? path.join(root, account.id.replace(':', '-'), providerId)
          : undefined
    if (!directory)
      throw new Error('Não foi possível determinar o diretório isolado desta conta CLI.')
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
    cliProfile = { envKey: providerId === 'codex' ? 'CODEX_HOME' : 'CLAUDE_CONFIG_DIR', directory }
  }
  const config: ProviderRuntimeConfig = {
    model: connection.defaultModel,
    // CLI instalado pelo app é usado quando o usuário não apontou outro caminho.
    cliPath: connection.cliPath || managedBinPath(providerId),
    cliArgs: connection.cliArgs,
    apiKeyEnv: connection.apiKeyEnv,
    apiKey,
    endpoint: connection.endpoint,
    effort: connection.effort,
    envKeys:
      providerId === 'acp'
        ? connection.apiKeyEnv
          ? [connection.apiKeyEnv]
          : []
        : (getCatalogEntry(providerId)?.envKeys ?? []),
    accountAuthMode: account.isDefault
      ? undefined
      : (account.authMode as 'api_key' | 'cli_profile'),
    cliProfile,
  }
  return { connection, account, config }
}

export function accountStatus(
  info: ProviderInfo,
  providerId: SupportedProvider,
  config: ProviderRuntimeConfig,
): ProviderInfo {
  if (
    config.accountAuthMode === 'api_key' &&
    config.cliProfile &&
    info.readiness === 'login_required'
  ) {
    return {
      ...info,
      readiness: 'unverified',
      authStatus: 'env',
      loginHint: 'Confira a API key salva nesta conta.',
      error:
        'O status do CLI não confirmou a autenticação por API key. Nenhum login compartilhado foi usado.',
    }
  }
  return config.accountAuthMode === 'cli_profile' && config.cliProfile
    ? {
        ...info,
        loginHint: profileLoginHint(providerId, config.cliPath, config.cliProfile.directory),
      }
    : info
}
