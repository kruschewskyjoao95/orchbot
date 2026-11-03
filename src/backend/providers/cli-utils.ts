import { execFile } from 'node:child_process'
import { constants, accessSync } from 'node:fs'
import path from 'node:path'
import { promisify, stripVTControlCharacters } from 'node:util'
import type { ProviderInfo } from '../../shared/types'
import { getCatalogEntry } from './catalog'
import { checkCliAuth, runCliProbe } from './cli-auth'
import type { ProviderRuntimeConfig } from './types'

const execFileAsync = promisify(execFile)

export function resolveCliCommand(cliCommand: string, cliPath?: string): string {
  const custom = cliPath?.trim()
  if (custom) return custom
  return cliCommand
}

export function isExecutableFile(p: string): boolean {
  try {
    accessSync(p, constants.X_OK)
    return true
  } catch {
    return false
  }
}

export async function findCliPath(
  cliCommand: string,
  cliPath?: string,
): Promise<string | undefined> {
  const custom = cliPath?.trim()
  if (custom) {
    if (isExecutableFile(custom) || path.isAbsolute(custom)) return custom
    return custom
  }
  try {
    const cmd = process.platform === 'win32' ? 'where' : 'which'
    const { stdout } = await execFileAsync(cmd, [cliCommand])
    const first = stdout
      .split('\n')
      .map((s) => s.trim())
      .find(Boolean)
    return first
  } catch {
    return undefined
  }
}

export function buildProviderEnv(config?: ProviderRuntimeConfig): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env }
  if (!config) return env
  if (config.accountAuthMode) {
    for (const name of [...(config.envKeys ?? []), ...(config.apiKeyEnv ? [config.apiKeyEnv] : [])])
      delete env[name]
    for (const name of ['OPENAI_BASE_URL', 'ANTHROPIC_BASE_URL']) delete env[name]
    if (config.cliProfile?.envKey === 'CODEX_HOME') {
      for (const name of ['CODEX_ACCESS_TOKEN', 'CODEX_AUTH_TOKEN']) delete env[name]
    }
    if (config.cliProfile?.envKey === 'CLAUDE_CONFIG_DIR') {
      for (const name of [
        'CLAUDE_CODE_OAUTH_TOKEN',
        'ANTHROPIC_AUTH_TOKEN',
        'ANTHROPIC_OAUTH_TOKEN',
        'CLAUDE_CODE_USE_BEDROCK',
        'CLAUDE_CODE_USE_VERTEX',
        'CLAUDE_CODE_USE_FOUNDRY',
      ])
        delete env[name]
    }
  }
  if (config.cliProfile) {
    env[config.cliProfile.envKey] = config.cliProfile.directory
    if (config.cliProfile.envKey === 'CODEX_HOME')
      env.CODEX_SQLITE_HOME = config.cliProfile.directory
  }
  if (config.extraEnv) Object.assign(env, config.extraEnv)
  const key = config.apiKey?.trim()
  if (key) {
    for (const name of config.envKeys ?? []) {
      env[name] = key
    }
  }
  const endpoint = config.endpoint?.trim()
  if (endpoint) {
    // Endpoint customizado/OpenAI-compatible: exposto nas variáveis usuais.
    // Adapters que suportam base URL usam ExecutionOptions.endpoint diretamente.
    env.OPENAI_BASE_URL = endpoint
    env.ANTHROPIC_BASE_URL = endpoint
  }
  return env
}

export async function checkCliAvailability(
  providerId: Parameters<typeof getCatalogEntry>[0],
  config?: ProviderRuntimeConfig,
): Promise<ProviderInfo> {
  const entry = getCatalogEntry(providerId)
  if (!entry) throw new Error('Provedor de CLI não encontrado.')
  const command = resolveCliCommand(entry.cliCommand, config?.cliPath)
  const resolvedPath = await findCliPath(entry.cliCommand, config?.cliPath)
  const env = buildProviderEnv({ ...config, envKeys: entry.envKeys })
  const probe = await runCliProbe(command, entry.versionArgs, env)
  const base = { path: resolvedPath, installHint: entry.installHint, loginHint: entry.loginHint }
  if (probe.code !== 0) {
    const missing = probe.code === 'ENOENT'
    return {
      ...base,
      available: false,
      readiness: missing ? 'not_installed' : 'error',
      authStatus: 'unknown',
      error: missing
        ? `CLI "${entry.cliCommand}" não instalado ou caminho configurado não encontrado.`
        : probe.killed
          ? 'O CLI não respondeu à checagem de versão no tempo limite.'
          : 'O CLI foi encontrado, mas não conseguiu iniciar. Confira a instalação e a configuração no terminal.',
    }
  }
  let version = stripVTControlCharacters(probe.stdout.trim().split('\n')[0])
  for (const key of [config?.apiKey, ...entry.envKeys.map((name) => env[name])]) {
    if (key) version = version.split(key).join('[REDACTED]')
  }
  version = version.slice(0, 200)
  const auth = await checkCliAuth(providerId, command, env, config?.model ?? entry.defaultModel)
  return { ...base, available: true, version, ...auth }
}

export function extractTextFromJsonLine(parsed: unknown): string | null {
  if (!parsed || typeof parsed !== 'object') return null
  const obj = parsed as Record<string, unknown>

  // Formatos NDJSON comuns: {type:'text', text} / {text} / {content}
  if (typeof obj.text === 'string') return obj.text
  if (typeof obj.content === 'string') return obj.content
  if (typeof obj.result === 'string') return obj.result

  const item = obj.item as Record<string, unknown> | undefined
  if (item && typeof item.text === 'string') return item.text

  const event = obj.event as Record<string, unknown> | undefined
  if (event) {
    const delta = event.delta as Record<string, unknown> | undefined
    if (delta && typeof delta.text === 'string') return delta.text
    if (typeof event.text === 'string') return event.text
  }

  const part = obj.part as Record<string, unknown> | undefined
  if (part && typeof part.text === 'string') return part.text

  const message = obj.message as Record<string, unknown> | undefined
  if (message) {
    const content = message.content
    if (typeof content === 'string') return content
    if (Array.isArray(content)) {
      const texts = content
        .map((c) =>
          c && typeof c === 'object' && typeof (c as Record<string, unknown>).text === 'string'
            ? ((c as Record<string, unknown>).text as string)
            : '',
        )
        .filter(Boolean)
      if (texts.length) return texts.join('')
    }
  }
  return null
}

export function parseStreamJsonLine(line: string, state: { fullText: string }): string | null {
  const trimmed = line.trim()
  if (!trimmed) return null
  try {
    const parsed = JSON.parse(trimmed) as unknown
    const text = extractTextFromJsonLine(parsed)
    if (text === null) return null
    // Texto cumulativo (codex/antigravity) vs delta (claude/opencode)
    if (text.length > state.fullText.length && text.startsWith(state.fullText)) {
      const chunk = text.slice(state.fullText.length)
      state.fullText = text
      return chunk
    }
    if (text === state.fullText) return null
    state.fullText += text
    return text
  } catch {
    return null
  }
}
