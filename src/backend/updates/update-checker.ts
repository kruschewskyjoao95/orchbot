import type { SupportedProvider } from '../../shared/types'
import { getCatalogEntry } from '../providers/catalog'

export interface ProviderUpdateInfo {
  providerId: SupportedProvider
  installedVersion: string | null
  latestVersion: string | null
  updateAvailable: boolean
  /** Comando sugerido para atualizar (npm global), quando aplicável. */
  updateCommand: string | null
  checkedAt: string
  error?: string
}

export const NPM_PACKAGES: Partial<Record<SupportedProvider, string>> = {
  codex: '@openai/codex',
  claude: '@anthropic-ai/claude-code',
  gemini: '@google/gemini-cli',
  opencode: 'opencode-ai',
  copilot: '@github/copilot',
  kimi: '@moonshot-ai/kimi-code',
  pi: '@mariozechner/pi-coding-agent',
}

export function parseSemver(text: string | null | undefined): string | null {
  if (!text) return null
  const match = text.match(/(\d+)\.(\d+)\.(\d+)/)
  return match ? `${match[1]}.${match[2]}.${match[3]}` : null
}

/** Retorna 1 se a > b, -1 se a < b, 0 se iguais (semver simples x.y.z). */
export function compareSemver(a: string, b: string): number {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (diff !== 0) return diff > 0 ? 1 : -1
  }
  return 0
}

export async function fetchLatestNpmVersion(
  pkg: string,
  fetcher: typeof fetch = fetch,
): Promise<string> {
  const res = await fetcher(`https://registry.npmjs.org/${pkg}/latest`, {
    signal: AbortSignal.timeout(12000),
  })
  if (!res.ok) throw new Error(`npm registry respondeu ${res.status}`)
  const data = (await res.json()) as { version?: string }
  if (!data.version) throw new Error('Versão não encontrada no npm')
  return data.version
}

export async function checkProviderUpdate(
  providerId: SupportedProvider,
  installedVersionRaw: string | undefined,
  fetcher: typeof fetch = fetch,
): Promise<ProviderUpdateInfo> {
  const checkedAt = new Date().toISOString()
  const installedVersion = parseSemver(installedVersionRaw)
  const pkg = NPM_PACKAGES[providerId]
  const entry = getCatalogEntry(providerId)

  if (!pkg) {
    return {
      providerId,
      installedVersion,
      latestVersion: null,
      updateAvailable: false,
      updateCommand: null,
      checkedAt,
      error: `${entry?.name ?? providerId} não publica versões no npm; atualização automática indisponível.`,
    }
  }

  try {
    const latestVersion = await fetchLatestNpmVersion(pkg, fetcher)
    return {
      providerId,
      installedVersion,
      latestVersion,
      updateAvailable:
        installedVersion !== null && compareSemver(latestVersion, installedVersion) > 0,
      updateCommand: `npm install -g ${pkg}@latest`,
      checkedAt,
    }
  } catch (err: unknown) {
    return {
      providerId,
      installedVersion,
      latestVersion: null,
      updateAvailable: false,
      updateCommand: `npm install -g ${pkg}@latest`,
      checkedAt,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}
