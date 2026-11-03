import { type AgentDraft, type AgentRole, normalizeAvatar } from '../../shared/types'
import type { Agent } from '../../shared/types'
import { runOneShot } from '../memory/memory-service'
import { resolveAccountRuntime } from '../providers/account-config'
import { getCatalogEntry } from '../providers/catalog'
import type { ProviderRegistry } from '../providers/registry'
import type { OrchbotDatabase } from '../storage/db'

const AVATARS = ['🤖', '🧠', '🛠️', '🔍', '📊', '✍️', '🧪', '🚀', '🛡️', '📚']

/** Rascunho 100% local, usado quando nenhum provedor responde. */
function localDraft(prompt: string, base?: Agent): AgentDraft {
  const text = prompt.trim().replace(/\s+/g, ' ')
  const words = text
    .split(' ')
    .filter((w) => w.length > 3)
    .slice(0, 3)
  const name =
    base?.name ?? (words.map((w) => w[0].toUpperCase() + w.slice(1)).join(' ') || 'Novo Agente')
  return {
    name,
    description: base?.description ?? text.slice(0, 140),
    role: base?.role ?? 'worker',
    avatar: base?.avatar ?? AVATARS[text.length % AVATARS.length],
    instructions: base ? `${base.instructions}\n\n${text}`.trim() : text,
    source: 'local',
  }
}

function parseDraft(raw: string, base?: Agent): AgentDraft | null {
  const json = raw.match(/\{[\s\S]*\}/)?.[0]
  if (!json) return null
  try {
    const o = JSON.parse(json) as Record<string, unknown>
    const str = (v: unknown, fallback = '') =>
      typeof v === 'string' && v.trim() ? v.trim() : fallback
    const name = str(o.name, base?.name ?? '')
    const instructions = str(o.instructions, base?.instructions ?? '')
    if (!name || !instructions) return null
    return {
      name: name.slice(0, 80),
      description: str(o.description, base?.description ?? '').slice(0, 200),
      role: (o.role === 'orchestrator'
        ? 'orchestrator'
        : o.role === 'worker'
          ? 'worker'
          : (base?.role ?? 'worker')) as AgentRole,
      avatar: normalizeAvatar(o.avatar) ?? base?.avatar ?? '🤖',
      instructions: instructions.slice(0, 8000),
      source: 'model',
    }
  } catch {
    return null
  }
}

/**
 * Gera (ou ajusta) um agente a partir de uma descrição em linguagem natural.
 * Não grava nada: a interface mostra o rascunho para revisão antes de salvar.
 */
export async function draftAgent(
  db: OrchbotDatabase,
  registry: ProviderRegistry,
  prompt: string,
  baseAgentId?: string,
): Promise<AgentDraft> {
  const text = prompt.trim()
  if (!text) throw new Error('Descreva o agente que você quer.')
  const base = baseAgentId ? (db.getAgent(baseAgentId) ?? undefined) : undefined
  const instruction = [
    base
      ? 'Você edita a configuração de um agente de IA. Aplique o pedido do usuário mantendo o que não foi pedido para mudar.'
      : 'Você projeta um agente de IA a partir da descrição do usuário.',
    'Responda SOMENTE com JSON: {"name":"nome curto","description":"1 frase","role":"worker|orchestrator","avatar":"um emoji","instructions":"instruções de sistema claras, em português, na 2ª pessoa"}',
    'Use role "orchestrator" apenas se o agente deve coordenar e delegar a outros agentes.',
    base
      ? `\nAgente atual:\n${JSON.stringify({ name: base.name, description: base.description, role: base.role, avatar: base.avatar, instructions: base.instructions })}`
      : '',
    `\nPedido do usuário:\n${text}`,
  ].join('\n')

  const candidates = [
    ...(base ? [base.provider] : []),
    ...db
      .listConnections()
      .filter((c) => c.enabled)
      .map((c) => c.providerId),
  ].filter((p, i, all) => all.indexOf(p) === i)

  for (const providerId of candidates.slice(0, 3)) {
    try {
      const adapter = registry.getAdapter(providerId)
      const { config } = resolveAccountRuntime(db, providerId)
      if (!(await adapter.checkAvailability(config)).available) continue
      const model =
        base?.provider === providerId
          ? base.model
          : (db.getConnection(providerId)?.defaultModel ??
            getCatalogEntry(providerId)?.defaultModel ??
            '')
      const raw = await runOneShot(adapter, config, model, instruction, 60_000)
      const draft = raw ? parseDraft(raw, base) : null
      if (draft) return draft
    } catch {
      // tenta o próximo provedor
    }
  }
  return localDraft(text, base)
}
