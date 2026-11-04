import type { ContextMode, Message } from '../../shared/types'

export interface BuiltContext {
  text: string
  estimatedTokens: number
  includedMessages: number
  summarizedMessages: number
}

export { estimateTokens } from '../../shared/tokens'
import { estimateTokens } from '../../shared/tokens'

interface ModeBudget {
  recentCount: number
  recentCharLimit: number
  digestCount: number
  digestCharLimit: number
  totalCharLimit: number
}

export const CONTEXT_BUDGETS: Record<ContextMode, ModeBudget> = {
  economico: {
    recentCount: 4,
    recentCharLimit: 280,
    digestCount: 6,
    digestCharLimit: 120,
    totalCharLimit: 1800,
  },
  padrao: {
    recentCount: 10,
    recentCharLimit: 800,
    digestCount: 10,
    digestCharLimit: 160,
    totalCharLimit: 6000,
  },
  completo: {
    recentCount: 100,
    recentCharLimit: 2000,
    digestCount: 0,
    digestCharLimit: 0,
    totalCharLimit: 24000,
  },
}

/** Limite das regras do projeto conforme o modo (elas voltam inteiras a cada turno). */
export function capRulesContent(content: string, mode: ContextMode): string {
  const limit = mode === 'economico' ? 1200 : mode === 'padrao' ? 4000 : 60_000 // completo: abaixo do limite de 128 KB por argumento do Linux
  if (content.length <= limit) return content
  return `${content.slice(0, limit)}\n[...regras truncadas no modo ${mode} para economizar tokens]`
}

function oneLineDigest(text: string, limit: number): string {
  const first = text.replace(/\s+/g, ' ').trim()
  return first.length > limit ? `${first.slice(0, limit)}…` : first
}

/**
 * Monta o histórico da conversa para o próximo turno sem mandar tudo:
 * mensagens recentes na íntegra (truncadas) + digest extrativo das antigas.
 */
export function buildThreadContext(
  messages: Message[],
  mode: ContextMode,
  compactedSummary?: string,
): BuiltContext {
  const budget = CONTEXT_BUDGETS[mode]
  // Ignora mensagens de sistema de aviso (delegação/recebimento) no histórico do modelo
  const usable = messages.filter((m) => m.role === 'user' || m.role === 'assistant')
  if (usable.length === 0 && !compactedSummary) {
    return { text: '', estimatedTokens: 0, includedMessages: 0, summarizedMessages: 0 }
  }

  const recent = usable.slice(-budget.recentCount)
  const older = usable.slice(0, Math.max(0, usable.length - recent.length))
  const digestSource = budget.digestCount > 0 ? older.slice(-budget.digestCount) : []

  const parts: string[] = []
  if (digestSource.length > 0) {
    const digest = digestSource
      .map((m) => `- [${m.role}] ${oneLineDigest(m.text, budget.digestCharLimit)}`)
      .join('\n')
    parts.push(`[RESUMO DAS MENSAGENS ANTERIORES]\n${digest}`)
  }
  if (recent.length > 0) {
    const history = recent
      .map(
        (m) =>
          `[${m.role === 'user' ? 'Usuário' : 'Assistente'}] ${oneLineDigest(m.text, budget.recentCharLimit)}`,
      )
      .join('\n')
    parts.push(`[HISTÓRICO RECENTE DA CONVERSA]\n${history}`)
  }

  let text = parts.join('\n\n')
  if (text.length > budget.totalCharLimit) {
    text = `${text.slice(0, budget.totalCharLimit)}\n[...histórico truncado no modo ${mode}]`
  }
  if (compactedSummary) {
    text = `[RESUMO COMPACTADO DA CONVERSA ANTERIOR]\n${compactedSummary.slice(0, 8000)}${text ? `\n\n${text}` : ''}`
  }

  return {
    text,
    estimatedTokens: estimateTokens(text),
    includedMessages: recent.length,
    summarizedMessages: digestSource.length,
  }
}
