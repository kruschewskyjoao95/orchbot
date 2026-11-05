import type { Agent, McpToolPolicy, SupportedProvider } from './types'

export function mcpToolSupport(
  provider: SupportedProvider,
): 'allow-deny' | 'deny' | 'transport' | 'none' {
  if (provider === 'codex') return 'allow-deny'
  if (provider === 'claude') return 'deny'
  if (provider === 'acp' || provider === 'antigravity') return 'transport'
  return 'none'
}

export function parseMcpToolPolicy(raw: unknown): McpToolPolicy {
  if (
    !raw ||
    typeof raw !== 'object' ||
    Array.isArray(raw) ||
    Object.keys(raw).some((k) => k !== 'allow' && k !== 'deny')
  )
    throw new Error('Política MCP inválida.')
  const value = raw as Record<string, unknown>
  const names = (list: unknown): string[] => {
    if (
      !Array.isArray(list) ||
      list.length > 128 ||
      list.some((name) => typeof name !== 'string' || !/^[A-Za-z0-9_.-]{1,128}$/.test(name))
    )
      throw new Error('Use até 128 nomes exatos de ferramentas MCP, sem espaços ou curingas.')
    return [...new Set(list)]
  }
  return {
    ...(value.allow === undefined ? {} : { allow: names(value.allow) }),
    deny: names(value.deny),
  }
}

export function hasMcpRestriction(policy: McpToolPolicy): boolean {
  return policy.allow !== undefined || policy.deny.length > 0
}

export function assertMcpToolSupport(provider: SupportedProvider, policy: McpToolPolicy): void {
  if (!hasMcpRestriction(policy)) return
  const support = mcpToolSupport(provider)
  if (support === 'none' || support === 'transport')
    throw new Error(
      'Este engine não aplica restrições MCP por ferramenta no Orchbot. O turno foi bloqueado.',
    )
  if (support === 'deny' && policy.allow !== undefined)
    throw new Error(
      'Claude aplica somente a lista de bloqueio MCP; uma lista de permissão exige Codex.',
    )
  if (support === 'deny' && policy.deny.some((name) => name.includes('.')))
    throw new Error('O filtro Claude ainda não aceita nomes de ferramenta com ponto.')
}

export const MCP_POLICY_MIN_VERSION = { codex: [0, 166, 0], claude: [2, 1, 318] } as const

/** Descreve o que o adapter solicita, sem afirmar que observou o sandbox resolvido do CLI. */
export function agentAuthority(agent: Pick<Agent, 'provider' | 'autonomyLevel'>) {
  const cautious = agent.autonomyLevel === 'cautious'
  return {
    mcpTools: mcpToolSupport(agent.provider),
    approvals:
      agent.provider === 'claude'
        ? cautious
          ? 'Permissões de ferramentas solicitadas ao CLI em modo manual.'
          : 'Permissões herdadas do CLI Claude.'
        : agent.provider === 'codex'
          ? cautious
            ? 'Codex exec sem diálogo: read-only solicitado; após aprovação, workspace-write no turno autorizado.'
            : 'Permissões e sandbox herdados do CLI Codex.'
          : agent.provider === 'acp' || agent.provider === 'antigravity'
            ? 'Pedidos ACP são apresentados quando o agente os emite; a política interna pertence ao agente.'
            : agent.provider.startsWith('custom:')
              ? 'Adapter HTTP sem execução nativa de ferramentas ou MCP.'
              : agent.provider === 'copilot'
                ? 'CLI iniciado com --allow-all-tools; o modo cauteloso do Orchbot não restringe suas ferramentas nativas.'
                : 'Adapter não aplica o modo cauteloso às ferramentas nativas; usa a configuração do CLI.',
    isolation:
      'Orchbot não adiciona sandbox de processos. Pastas separadas não isolam disco, rede ou credenciais.',
    scope:
      agent.provider === 'codex'
        ? 'Filtro nativo dos servidores MCP vinculados. Outros MCP/plugins do perfil Codex podem permanecer disponíveis. Read-only do filesystem não impede escrita em serviços por MCP.'
        : agent.provider === 'claude'
          ? 'MCP fornecido por --strict-mcp-config. Ferramentas nativas não são limitadas por esta lista.'
          : 'Nenhuma garantia de filtro de ferramentas nativas ou MCP por esta integração.',
  }
}
