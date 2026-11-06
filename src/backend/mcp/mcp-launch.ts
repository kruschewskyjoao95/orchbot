import fs from 'node:fs'
import path from 'node:path'
import { assertMcpToolSupport, parseMcpToolPolicy } from '../../shared/authority'
import type { McpLaunchServer } from '../providers/types'

/** Variáveis que um servidor MCP nunca pode sobrescrever no processo do CLI. */
const RESERVED_ENV = new Set([
  'PATH',
  'HOME',
  'USER',
  'SHELL',
  'PWD',
  'TMPDIR',
  'LD_PRELOAD',
  'LD_LIBRARY_PATH',
  'NODE_OPTIONS',
  'NODE_PATH',
  'PYTHONPATH',
  'PYTHONHOME',
  'ELECTRON_RUN_AS_NODE',
  'CODEX_HOME',
  'CLAUDE_CONFIG_DIR',
])

export function isSafeEnvKey(key: string): boolean {
  return (
    /^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(key) &&
    !RESERVED_ENV.has(key.toUpperCase()) &&
    !key.toUpperCase().startsWith('ORCHBOT_')
  )
}

const ns = (index: number, key: string) => `ORCHBOT_MCP_${index}_${key}`

/**
 * Claude expande ${VAR} dentro do --mcp-config, então o segredo vai só no ambiente do processo.
 * --strict-mcp-config: o agente usa exatamente os servidores escolhidos para ele.
 */
export function claudeMcp(servers: McpLaunchServer[]): {
  args: string[]
  env: Record<string, string>
} {
  const env: Record<string, string> = {}
  const mcpServers: Record<string, unknown> = {}
  const blocked: string[] = []
  servers.forEach((s, i) => {
    if (s.toolPolicy) {
      const policy = parseMcpToolPolicy(s.toolPolicy)
      assertMcpToolSupport('claude', policy)
      blocked.push(...policy.deny.map((name) => `mcp__${s.name}__${name}`))
    }
    if (s.transport === 'http') {
      const headers: Record<string, string> = {}
      if (s.bearerToken) {
        env[ns(i, 'BEARER')] = s.bearerToken
        headers.Authorization = `Bearer \${${ns(i, 'BEARER')}}`
      }
      mcpServers[s.name] = { type: 'http', url: s.url, headers }
    } else {
      const own: Record<string, string> = {}
      for (const [k, v] of Object.entries(s.env)) {
        env[ns(i, k)] = v
        own[k] = `\${${ns(i, k)}}`
      }
      mcpServers[s.name] = { command: s.command, args: s.args, env: own }
    }
  })
  return {
    args: [
      '--strict-mcp-config',
      '--mcp-config',
      JSON.stringify({ mcpServers }),
      ...(blocked.length ? ['--disallowedTools', blocked.join(',')] : []),
    ],
    env,
  }
}

/**
 * Codex lê `-c mcp_servers.<nome>.*` e encaminha as variáveis listadas em env_vars.
 * shortcut: o servidor vê o nome real da variável, então duas entradas com a mesma chave e valores
 * diferentes colidem (vence a última); separar por servidor exigiria um arquivo de config isolado.
 */
export function codexMcp(servers: McpLaunchServer[]): {
  args: string[]
  env: Record<string, string>
} {
  const args: string[] = []
  const env: Record<string, string> = {}
  servers.forEach((s, i) => {
    const key = `mcp_servers.${s.name}`
    if (s.toolPolicy) {
      const policy = parseMcpToolPolicy(s.toolPolicy)
      assertMcpToolSupport('codex', policy)
      if (policy.allow !== undefined)
        args.push('-c', `${key}.enabled_tools=${JSON.stringify(policy.allow)}`)
      args.push('-c', `${key}.disabled_tools=${JSON.stringify(policy.deny)}`)
    }
    if (s.transport === 'http') {
      args.push('-c', `${key}.url=${JSON.stringify(s.url)}`)
      if (s.bearerToken) {
        env[ns(i, 'BEARER')] = s.bearerToken
        args.push('-c', `${key}.bearer_token_env_var=${JSON.stringify(ns(i, 'BEARER'))}`)
      }
      return
    }
    args.push('-c', `${key}.command=${JSON.stringify(s.command)}`)
    if (s.args.length) args.push('-c', `${key}.args=${JSON.stringify(s.args)}`)
    const names = Object.keys(s.env)
    if (names.length) args.push('-c', `${key}.env_vars=${JSON.stringify(names)}`)
    Object.assign(env, s.env)
  })
  return { args, env }
}

/** Procura o executável no PATH: o ACP pede caminho absoluto para servidores stdio. */
export function resolveExecutable(command: string, pathVar = process.env.PATH ?? ''): string {
  if (path.isAbsolute(command)) return command
  for (const dir of pathVar.split(path.delimiter)) {
    if (!dir) continue
    const candidate = path.join(dir, command)
    try {
      fs.accessSync(candidate, fs.constants.X_OK)
      if (fs.statSync(candidate).isFile()) return candidate
    } catch {
      // próximo diretório
    }
  }
  return command
}

type AcpMcpServer =
  | { name: string; command: string; args: string[]; env: { name: string; value: string }[] }
  | { type: 'http'; name: string; url: string; headers: { name: string; value: string }[] }

/**
 * ACP: os servidores vão no `session/new`, pelo próprio protocolo (stdio do agente), então os segredos
 * não passam por argv nem por variável de ambiente do Orchbot. Servidores HTTP só se o agente declarar suporte.
 */
export function acpMcp(
  servers: McpLaunchServer[],
  caps?: { http?: boolean },
  which: (c: string) => string = resolveExecutable,
): { servers: AcpMcpServer[]; skipped: string[] } {
  const out: AcpMcpServer[] = []
  const skipped: string[] = []
  for (const s of servers) {
    if (s.toolPolicy) assertMcpToolSupport('acp', parseMcpToolPolicy(s.toolPolicy))
    if (s.transport === 'http') {
      if (!caps?.http) {
        skipped.push(s.name)
        continue
      }
      out.push({
        type: 'http',
        name: s.name,
        url: s.url ?? '',
        headers: s.bearerToken ? [{ name: 'Authorization', value: `Bearer ${s.bearerToken}` }] : [],
      })
    } else
      out.push({
        name: s.name,
        command: which(s.command ?? ''),
        args: s.args,
        env: Object.entries(s.env).map(([name, value]) => ({ name, value })),
      })
  }
  return { servers: out, skipped }
}
