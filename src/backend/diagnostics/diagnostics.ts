import os from 'node:os'
import { redactSecrets } from '../browser/sanitizer'
import type { OrchbotDatabase } from '../storage/db'

/** Remove segredos óbvios, credenciais em URLs e o caminho da pasta pessoal. */
export function redactText(text: string, home = os.homedir()): string {
  let out = redactSecrets(text)
  out = out.replace(/(https?:\/\/)[^\s/@:]+(?::[^\s/@]*)?@/gi, '$1[REDACTED]@')
  out = out.replace(/\b(sk|xai|gsk|ghp|github_pat|AIza)[-_A-Za-z0-9]{16,}/g, '[REDACTED_KEY]')
  out = out.replace(
    /\b[A-Za-z0-9_-]{24,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{16,}\b/g,
    '[REDACTED_JWT]',
  )
  if (home && home !== '/') out = out.split(home).join('~')
  return out
}

export interface DiagnosticsExtra {
  appVersion: string
  electron?: string
  providers: Record<
    string,
    {
      available?: boolean
      version?: string
      readiness?: string
      authStatus?: string
      error?: string
    }
  >
  managedClis?: unknown
}

/**
 * Relatório para suporte. Só inclui contagens, versões, estados e erros recentes redigidos:
 * nunca mensagens, instruções de agentes, chaves, variáveis de MCP, endpoints ou caminhos de usuário.
 */
export function buildDiagnostics(db: OrchbotDatabase, extra: DiagnosticsExtra) {
  const settings = db.getSettings()
  const agents = db.listAgents()
  const count = (sql: string, ...args: string[]) =>
    (
      (
        db as unknown as {
          db: { prepare: (q: string) => { get: (...a: string[]) => { n: number } } }
        }
      ).db
        .prepare(sql)
        .get(...args) as { n: number }
    ).n
  const rows = (sql: string) =>
    (db as unknown as { db: { prepare: (q: string) => { all: () => unknown[] } } }).db
      .prepare(sql)
      .all()

  const failed = rows(
    "SELECT status, error, completed_at AS at FROM task_queue WHERE status IN ('failed','interrupted') ORDER BY completed_at DESC LIMIT 15",
  ) as { status: string; error: string | null; at: string | null }[]

  return {
    generatedAt: new Date().toISOString(),
    app: {
      version: extra.appVersion,
      electron: extra.electron,
      node: process.versions.node,
      platform: process.platform,
      arch: process.arch,
      os: os.release(),
    },
    note: 'Sem mensagens, instruções, chaves, variáveis de MCP, endpoints ou nomes de pasta pessoais.',
    settings: {
      theme: settings.theme,
      language: settings.language,
      customTheme: settings.customTheme ? 'sim' : 'não',
      autoUpdate: settings.autoUpdate,
      keepRunningInBackground: settings.keepRunningInBackground,
      consentAccepted: Boolean(settings.consentAcceptedAt),
      consentVersion: settings.consentVersion ?? null,
    },
    counts: {
      agents: agents.length,
      threads: count('SELECT COUNT(*) AS n FROM threads'),
      messages: count('SELECT COUNT(*) AS n FROM messages'),
      memories: count('SELECT COUNT(*) AS n FROM agent_memories'),
      channels: count('SELECT COUNT(*) AS n FROM channels'),
      mcpServers: count('SELECT COUNT(*) AS n FROM mcp_servers'),
      tasksByStatus: Object.fromEntries(
        (
          rows('SELECT status, COUNT(*) AS n FROM task_queue GROUP BY status') as {
            status: string
            n: number
          }[]
        ).map((r) => [r.status, r.n]),
      ),
    },
    agents: agents.map((a) => ({
      provider: a.provider,
      model: a.model,
      role: a.role ?? 'worker',
      hasAccount: Boolean(a.accountId),
      paused: db.listPausedAgentIds().includes(a.id),
    })),
    connections: db.listConnections().map((c) => ({
      provider: c.providerId,
      enabled: c.enabled,
      custom: c.providerId.startsWith('custom:'),
      hasApiKey: Boolean(c.hasApiKey),
      customCliPath: Boolean(c.cliPath),
      ...extra.providers[c.providerId],
      error: extra.providers[c.providerId]?.error
        ? redactText(String(extra.providers[c.providerId]?.error))
        : undefined,
    })),
    managedClis: extra.managedClis,
    recentFailures: failed.map((f) => ({
      status: f.status,
      at: f.at,
      error: f.error ? redactText(f.error).slice(0, 300) : null,
    })),
  }
}
