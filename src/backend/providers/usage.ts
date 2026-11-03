import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { TurnUsage } from './types'

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0)

/**
 * Claude (`result` do stream-json): `usage` é do turno inteiro. O contexto que ocupa a janela é o
 * prompt da ÚLTIMA requisição (`iterations`), não a soma do turno; a janela vem de `modelUsage`.
 */
export function parseClaudeUsage(event: unknown): TurnUsage | undefined {
  const e = event as {
    usage?: Record<string, unknown>
    modelUsage?: Record<string, Record<string, unknown>>
  }
  const u = e?.usage
  if (!u || typeof u !== 'object') return undefined
  const cached = num(u.cache_read_input_tokens)
  const input = num(u.input_tokens) + num(u.cache_creation_input_tokens) + cached
  const output = num(u.output_tokens)
  if (input + output === 0) return undefined

  let contextTokens: number | undefined
  const iterations = Array.isArray(u.iterations) ? (u.iterations as Record<string, unknown>[]) : []
  const last = iterations[iterations.length - 1]
  if (last)
    contextTokens =
      num(last.input_tokens) +
      num(last.cache_creation_input_tokens) +
      num(last.cache_read_input_tokens) +
      num(last.output_tokens)

  // O modelo principal é o que mais consumiu (subagentes e modelos auxiliares aparecem à parte).
  let contextWindow: number | undefined
  let biggest = -1
  for (const m of Object.values(e.modelUsage ?? {})) {
    const used =
      num(m.inputTokens) +
      num(m.cacheReadInputTokens) +
      num(m.cacheCreationInputTokens) +
      num(m.outputTokens)
    if (used > biggest && num(m.contextWindow) > 0) {
      biggest = used
      contextWindow = num(m.contextWindow)
    }
  }
  return {
    inputTokens: input,
    outputTokens: output,
    cachedTokens: cached,
    contextTokens,
    contextWindow,
  }
}

/** Codex (`turn.completed`): o contador é ACUMULADO da sessão; `cumulative` avisa quem for somar. */
export function parseCodexUsage(event: unknown): TurnUsage | undefined {
  const u = (event as { usage?: Record<string, unknown> })?.usage
  if (!u || typeof u !== 'object') return undefined
  const input = num(u.input_tokens)
  const output = num(u.output_tokens)
  if (input + output === 0) return undefined
  return {
    inputTokens: input,
    outputTokens: output,
    cachedTokens: num(u.cached_input_tokens),
    cumulative: true,
  }
}

export function codexHome(configured?: string): string {
  return configured || process.env.CODEX_HOME || path.join(os.homedir(), '.codex')
}

function findRollout(sessionsDir: string, sessionId: string): string | undefined {
  const sorted = (dir: string) => (fs.existsSync(dir) ? fs.readdirSync(dir).sort().reverse() : [])
  for (const y of sorted(sessionsDir))
    for (const m of sorted(path.join(sessionsDir, y)))
      for (const d of sorted(path.join(sessionsDir, y, m))) {
        const dir = path.join(sessionsDir, y, m, d)
        const hit = fs.readdirSync(dir).find((f) => f.endsWith(`${sessionId}.jsonl`))
        if (hit) return path.join(dir, hit)
      }
  return undefined
}

/**
 * O `exec --json` do Codex não informa o tamanho do contexto, mas o arquivo da sessão guarda, a cada
 * requisição, `last_token_usage` (o prompt real) e `model_context_window`. Lê só o fim do arquivo.
 */
export function readCodexContext(
  sessionId: string,
  home = codexHome(),
): { contextTokens: number; contextWindow?: number } | undefined {
  try {
    const file = findRollout(path.join(home, 'sessions'), sessionId)
    if (!file) return undefined
    const fd = fs.openSync(file, 'r')
    try {
      const size = fs.fstatSync(fd).size
      const length = Math.min(size, 512 * 1024)
      const buf = Buffer.alloc(length)
      fs.readSync(fd, buf, 0, length, size - length)
      const lines = buf.toString('utf8').split('\n')
      for (let i = lines.length - 1; i >= 0; i--) {
        if (!lines[i].includes('token_count')) continue
        try {
          const p = JSON.parse(lines[i]).payload
          const last = p?.info?.last_token_usage
          if (p?.type === 'token_count' && last)
            return {
              contextTokens: num(last.input_tokens) + num(last.output_tokens),
              contextWindow: num(p.info.model_context_window) || undefined,
            }
        } catch {
          // linha cortada no começo do trecho lido
        }
      }
    } finally {
      fs.closeSync(fd)
    }
  } catch {
    // sem arquivo de sessão: quem chama cai na estimativa
  }
  return undefined
}
