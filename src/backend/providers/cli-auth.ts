import { execFile } from 'node:child_process'
import type { ProviderInfo, SupportedProvider } from '../../shared/types'

type AuthResult = Pick<ProviderInfo, 'readiness' | 'authStatus' | 'error'>
export interface CliProbe {
  stdout: string
  stderr: string
  code: number | string | null
  killed: boolean
}

export function runCliProbe(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
): Promise<CliProbe> {
  return new Promise((resolve) => {
    const child = execFile(
      command,
      args,
      {
        env: { ...env, NO_COLOR: '1' },
        timeout: 8000,
        maxBuffer: 256 * 1024,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        resolve({
          stdout,
          stderr,
          code: error?.code ?? (error ? null : 0),
          killed: Boolean(error?.killed),
        })
      },
    )
    child.stdin?.end()
  })
}

export async function checkCliAuth(
  provider: SupportedProvider,
  command: string,
  env: NodeJS.ProcessEnv,
  model: string,
): Promise<AuthResult> {
  const args =
    provider === 'codex'
      ? ['login', 'status']
      : provider === 'claude'
        ? ['auth', 'status', '--json']
        : provider === 'pi'
          ? ['auth', 'check', '--model', model, '--json']
          : provider === 'opencode'
            ? ['auth', 'list', '--format', 'json']
            : provider === 'muse'
              ? ['usage', '--json']
              : undefined
  if (!args)
    return {
      readiness: 'unverified',
      authStatus: 'unknown',
      error:
        'CLI instalado. Esta integração não dispõe de uma checagem segura de login sem executar um turno.',
    }
  const probe = await runCliProbe(command, args, env)
  if (probe.killed)
    return {
      readiness: 'error',
      authStatus: 'unknown',
      error: 'A checagem de login excedeu o tempo limite. Tente novamente.',
    }
  if (typeof probe.code !== 'number')
    return {
      readiness: 'error',
      authStatus: 'unknown',
      error: 'Não foi possível executar a checagem de login do CLI.',
    }
  let raw: unknown
  let data: Record<string, unknown> | undefined
  try {
    raw = JSON.parse(probe.stdout)
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) data = raw as Record<string, unknown>
  } catch {
    /* Codex uses text; old CLI versions may not support this command. */
  }
  if (provider === 'claude' && typeof data?.loggedIn === 'boolean') {
    if (data.loggedIn && probe.code === 0)
      return { readiness: 'ready', authStatus: data.authMethod === 'api_key' ? 'env' : 'cli' }
    if (!data.loggedIn && (probe.code === 0 || probe.code === 1))
      return {
        readiness: 'login_required',
        authStatus: 'missing',
        error: 'Claude não está autenticado. Entre novamente pelo CLI.',
      }
  }
  if (provider === 'pi') {
    if (data?.status === 'ready' && probe.code === 0)
      return { readiness: 'ready', authStatus: 'cli' }
    if (data?.status === 'not_ready' && probe.code === 1)
      return {
        readiness: 'login_required',
        authStatus: 'missing',
        error:
          'Pi não tem credenciais prontas para o modelo selecionado. Faça login ou configure a chave correspondente.',
      }
    if (data?.status === 'invalid' && probe.code === 2)
      return {
        readiness: 'error',
        authStatus: 'unknown',
        error: 'Pi não conseguiu resolver o provedor/modelo configurado. Confira o modelo padrão.',
      }
  }
  if (provider === 'opencode' && probe.code === 0 && Array.isArray(raw)) {
    const valid = raw.every(
      (item: unknown) =>
        item &&
        typeof item === 'object' &&
        'id' in item &&
        typeof item.id === 'string' &&
        'connections' in item &&
        Array.isArray(item.connections) &&
        item.connections.every(
          (connection: unknown) =>
            connection &&
            typeof connection === 'object' &&
            'type' in connection &&
            (connection.type === 'credential' || connection.type === 'environment'),
        ),
    )
    if (!valid)
      return {
        readiness: 'unverified',
        authStatus: 'unknown',
        error: 'A lista de autenticação do OpenCode tem um formato não reconhecido.',
      }

    const selected = model.includes('/') ? model.split('/')[0] : undefined
    const integration = raw.find(
      (item: unknown) => item && typeof item === 'object' && 'id' in item && item.id === selected,
    )
    if (
      integration &&
      Array.isArray(integration.connections) &&
      integration.connections.some(
        (connection: unknown) =>
          connection &&
          typeof connection === 'object' &&
          'type' in connection &&
          ['credential', 'environment'].includes(String(connection.type)),
      )
    ) {
      return { readiness: 'ready', authStatus: 'cli' }
    }
    if (selected && ['opencode-go', 'openai', 'anthropic', 'github-copilot'].includes(selected))
      return {
        readiness: 'login_required',
        authStatus: 'missing',
        error: 'OpenCode não encontrou credenciais para o provedor do modelo padrão.',
      }
    return {
      readiness: 'unverified',
      authStatus: 'unknown',
      error:
        'OpenCode não confirmou credenciais para o modelo padrão. Confira o prefixo provedor/modelo e a autenticação no terminal.',
    }
  }
  if (provider === 'muse' && probe.code === 0 && data?.schemaVersion === 1) {
    if (
      data.allowance &&
      typeof data.allowance === 'object' &&
      !Array.isArray(data.allowance) &&
      Object.keys(data.allowance).length > 0
    )
      return { readiness: 'ready', authStatus: 'cli' }
    if (
      typeof data.reason === 'string' &&
      /not_authenticated|unauthenticated|not_logged_in|login_required/.test(data.reason)
    )
      return {
        readiness: 'login_required',
        authStatus: 'missing',
        error: 'Muse não está autenticado. Entre novamente pelo CLI.',
      }
    return {
      readiness: 'unverified',
      authStatus: 'unknown',
      error:
        'Muse não confirmou uma sessão autenticada na consulta de uso. Uma resposta sem allowance não comprova login.',
    }
  }
  const output = `${probe.stdout}\n${probe.stderr}`
  if (
    provider === 'muse' &&
    probe.code !== 0 &&
    /not logged in|not authenticated|unauthorized|authentication required/i.test(output)
  )
    return {
      readiness: 'login_required',
      authStatus: 'missing',
      error: 'Muse exige login antes de consultar a conta.',
    }
  if (provider === 'codex') {
    if (probe.code === 0)
      return { readiness: 'ready', authStatus: /api key/i.test(output) ? 'env' : 'cli' }
    if (probe.code === 1 && /not logged in|not authenticated|login required/i.test(output))
      return {
        readiness: 'login_required',
        authStatus: 'missing',
        error: 'Codex não está autenticado. Entre novamente pelo CLI.',
      }
  }
  if (
    /unknown (?:command|subcommand|option)|unrecognized (?:command|subcommand|option)|unexpected (?:argument|option)/i.test(
      output,
    )
  ) {
    return {
      readiness: 'unverified',
      authStatus: 'unknown',
      error:
        'Esta versão do CLI não suporta a checagem de login. Atualize o CLI ou confira o login no terminal.',
    }
  }
  return {
    readiness: probe.code === 0 ? 'unverified' : 'error',
    authStatus: 'unknown',
    error:
      'A checagem de login falhou ou retornou um formato não reconhecido. Confira o CLI no terminal.',
  }
}
