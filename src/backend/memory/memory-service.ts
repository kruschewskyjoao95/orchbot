import { tmpdir } from 'node:os'
import { contextWindowFor, estimateTokens } from '../../shared/tokens'
import type { Agent, Message } from '../../shared/types'
import { isForeman } from '../orchestration/foreman'
import type { ProviderAdapter, ProviderRuntimeConfig, TurnUsage } from '../providers/types'
import { slugify } from '../skills/skill-service'
import type { OrchbotDatabase } from '../storage/db'
import { curatorPrompt, isProcedure, parseCuratorPlan } from './curator'
import { type MemoryDirective, buildMemoryInstructions } from './memory-protocol'

/** Compacta ao passar desta fração da janela do modelo. */
export const COMPACT_AT = 0.7
const KEEP_RECENT = 6
/** Mensagens que o curador lê: a última troca e um pouco de contexto. */
const REVIEW_WINDOW = 4
const MAX_MEMORIES_IN_PROMPT = 30
const short = (id: string) => id.slice(0, 8)
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)
const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim()

type Ctx = { agent: Agent; adapter: ProviderAdapter; config: ProviderRuntimeConfig }

/** `ready` segura a gravação até a fila terminar as outras esperas do turno (por exemplo o git). */
interface CompactOptions {
  signal?: AbortSignal
  ready?: Promise<void>
}

interface ReviewResult {
  status: 'ok' | 'failed'
  added: number
  updated: number
  removed: number
  skill?: string
  tokens?: number
}

function describeReview(r: ReviewResult): string {
  const cost = r.tokens ? ` (${r.tokens} tokens)` : ''
  if (r.status === 'failed')
    return `🧠 A revisão de memórias não concluiu: o modelo não respondeu ou devolveu algo inválido${cost}.`
  if (r.added === 0 && r.updated === 0 && r.removed === 0 && !r.skill)
    return `🧠 Memórias revisadas: nada novo${cost}.`
  const parts = [`+${r.added} nova(s)`, `−${r.removed} removida(s)`]
  if (r.updated > 0) parts.splice(1, 0, `${r.updated} atualizada(s)`)
  const skill = r.skill ? ` Proposta de skill: ${r.skill}.` : ''
  return `🧠 Memórias revisadas: ${parts.join(', ')}${cost}.${skill}`
}

export class MemoryService {
  private reviewing = new Set<string>()

  constructor(private db: OrchbotDatabase) {}

  /** Instruções + memórias guardadas do agente, para o prompt de cada turno. */
  public contextSections(agentId: string): string[] {
    if (isForeman(this.db.getAgent(agentId))) {
      return [
        '[MEMÓRIA] Você não guarda preferência pessoal. Fato da empresa vai para o cérebro do projeto, com [[BRAIN:write]].',
      ]
    }
    const memories = this.db.listMemories(agentId, MAX_MEMORIES_IN_PROMPT)
    const sections = [buildMemoryInstructions()]
    if (memories.length > 0)
      sections.push(
        `[MEMÓRIAS DO AGENTE]\n${memories.map((m) => `- (${short(m.id)}) [${m.kind === 'task' ? 'tarefa' : 'preferência'}] ${clip(oneLine(m.text), 400)}`).join('\n')}`,
      )
    return sections
  }

  /** Executa os blocos; devolve linhas de resultado para o modelo. */
  public run(agentId: string, directives: MemoryDirective[]): string[] {
    const out: string[] = []
    for (const d of directives) {
      const label = `${d.kind.toLowerCase()}:${d.action}`
      if (d.kind === 'MEMORY' && d.action === 'remember') {
        if (isForeman(this.db.getAgent(agentId))) {
          out.push(
            `[${label}] recusado: o coordenador não guarda preferência pessoal. Fato da empresa vai para [[BRAIN:write]].`,
          )
        } else if (isProcedure(d.body)) {
          out.push(
            `[${label}] não memorizado: procedimento vai para [[SKILL:create]], como proposta.`,
          )
        } else {
          this.db.addMemory(agentId, d.body)
          out.push(`[${label}] memorizado.`)
        }
      } else if (d.kind === 'MEMORY' && d.action === 'forget') {
        out.push(
          `[${label}] ${this.db.deleteMemory(agentId, d.body) ? 'esquecido.' : 'id não encontrado ou ambíguo.'}`,
        )
      } else if (d.kind === 'MEMORY') {
        const hits = this.db.searchMemories(agentId, d.body)
        out.push(
          `[${label}] ${hits.length ? hits.map((m) => `(${short(m.id)}) ${clip(oneLine(m.text), 400)}`).join('\n') : 'nenhuma memória encontrada.'}`,
        )
      } else if (d.action === 'search') {
        const hits = this.db.searchMessages(d.body, { agentId, limit: 6 })
        out.push(
          `[${label}] ${
            hits.length
              ? hits
                  .map(
                    (h) =>
                      `(${short(h.id)}) "${h.threadTitle}" [${h.role}] ${clip(oneLine(h.snippet.replace(/<\/?b>/g, '')), 300)}`,
                  )
                  .join('\n')
              : 'nada encontrado no histórico.'
          }`,
        )
      } else {
        const ctx = this.db.readMessageContext(agentId, d.body)
        out.push(
          `[${label}] ${
            ctx.length
              ? ctx.map((m) => `(${short(m.id)}) [${m.role}] ${clip(m.text, 1500)}`).join('\n')
              : 'mensagem não encontrada (ou id ambíguo).'
          }`,
        )
      }
    }
    return out
  }

  /** Mensagens ainda "vivas" no contexto: depois do último resumo e sem avisos de sistema. */
  public activeMessages(threadId: string, before: string): Message[] {
    return this.afterSummary(threadId, this.db.listMessages(threadId)).filter(
      (m) => (m.role === 'user' || m.role === 'assistant') && m.createdAt < before,
    )
  }

  /** Mensagens posteriores ao resumo salvo (por id: timestamps podem empatar). */
  public afterSummary(threadId: string, messages: Message[]): Message[] {
    const covered = this.db.getThreadSummary(threadId)?.coversUntil
    const i = covered ? messages.findIndex((m) => m.id === covered) : -1
    return messages.slice(i + 1)
  }

  /**
   * `live`: provedor (e, na fila, escopo da sessão) do próximo turno. A medição da CLI descreve uma
   * sessão nativa; se o turno não vai continuá-la (outro provedor/conta/workspace, reset, compactação),
   * o contexto é reconstruído e vale a estimativa.
   */
  public contextUsage(
    threadId: string,
    model: string,
    before = '9999',
    live?: { provider: string; scope?: string },
  ): { tokens: number; window: number; measured: boolean } {
    const summary = this.db.getThreadSummary(threadId)
    const last = this.db.lastMeasuredContext(threadId)
    const session = this.db.getThreadSession(threadId)
    const sameSession =
      !live ||
      (Boolean(last?.sessionId) &&
        session?.sessionId === last?.sessionId &&
        session?.providerId === live.provider &&
        (live.scope === undefined || session?.scope === live.scope))
    if (last && sameSession && (!summary || last.createdAt > summary.updatedAt)) {
      const all = this.db.listMessages(threadId)
      const i = all.findIndex((m) => m.id === last.messageId)
      const newer = all
        .slice(i + 1)
        .filter((m) => (m.role === 'user' || m.role === 'assistant') && m.createdAt < before)
      return {
        tokens: last.contextTokens + newer.reduce((n, m) => n + estimateTokens(m.text), 0),
        window: last.contextWindow ?? contextWindowFor(model),
        measured: true,
      }
    }
    const tokens =
      estimateTokens(summary?.summary ?? '') +
      this.activeMessages(threadId, before).reduce((n, m) => n + estimateTokens(m.text), 0)
    return { tokens, window: contextWindowFor(model), measured: false }
  }

  /**
   * Compacta o histórico antigo num resumo antes de estourar a janela. Em CLIs com sessão nativa,
   * descarta a sessão para o próximo turno recomeçar de resumo + mensagens recentes.
   * Devolve um aviso para a conversa quando compactou.
   */
  public async compactIfNeeded(
    ctx: Ctx,
    threadId: string,
    before: string,
    sessionScope?: string,
    options?: CompactOptions,
  ): Promise<string | undefined> {
    const active = this.activeMessages(threadId, before)
    const { tokens, window } = this.contextUsage(threadId, ctx.agent.model, before, {
      provider: ctx.agent.provider,
      scope: sessionScope,
    })
    const overflowing = tokens >= window * COMPACT_AT
    // Sem sessão nativa o histórico é reenviado a cada turno com orçamento fixo: resumir cedo preserva o que seria cortado.
    const bootstrapTooLong = !ctx.adapter.supportsSessionResume && active.length > 30
    if ((!overflowing && !bootstrapTooLong) || active.length <= KEEP_RECENT + 1) return undefined

    const older = active.slice(0, -KEEP_RECENT)
    const previous = this.db.getThreadSummary(threadId)?.summary
    const transcript = older.map((m) => `[${m.role}] ${clip(oneLine(m.text), 1200)}`).join('\n')
    const generated = await this.oneShot(
      ctx,
      [
        'Resuma a conversa abaixo para continuar o trabalho depois, em português, em tópicos curtos (máx. 25 linhas).',
        'Preserve: objetivo, decisões, fatos, caminhos de arquivos, comandos, pendências e preferências do usuário.',
        'Responda SOMENTE com o resumo. Não use ferramentas nem blocos [[...]].',
        previous ? `\nResumo anterior:\n${previous}` : '',
        `\nConversa:\n${transcript}`,
      ].join('\n'),
      90_000,
      options?.signal,
    )
    // Pausar ou cancelar no meio do resumo: não grava e não apaga a sessão nativa.
    if (options?.signal?.aborted || !this.db.isOpen()) return undefined
    if (options?.ready) await options.ready
    if (options?.signal?.aborted || !this.db.isOpen()) return undefined
    // Fallback 100% local: resumo extrativo, sem chamar modelo.
    const summary =
      generated?.trim() ||
      [previous, ...older.map((m) => `- [${m.role}] ${clip(oneLine(m.text), 160)}`)]
        .filter(Boolean)
        .join('\n')
        .slice(-8000)
    this.db.saveThreadSummary(threadId, summary, older[older.length - 1].id)
    if (ctx.adapter.supportsSessionResume) this.db.clearProviderSession(threadId)
    return `🗜️ Contexto compactado (${older.length} mensagens → resumo, ~${Math.round((tokens / window) * 100)}% da janela). Detalhes antigos continuam acessíveis via busca no histórico.`
  }

  /**
   * Curador depois do turno: pede ao modelo, num passo próprio, o que muda na memória (não bloqueia a fila).
   * Se uma revisão do mesmo robô ainda roda, esta é pulada; a próxima lê a mesma janela de mensagens.
   * `onResult` recebe uma linha para a conversa quando algo mudou ou falhou: a revisão gasta uma chamada.
   */
  public maybeReview(ctx: Ctx, threadId: string, onResult?: (notice: string) => void): void {
    if (isForeman(ctx.agent)) return
    const id = ctx.agent.id
    if (this.reviewing.has(id)) return
    this.reviewing.add(id)
    void this.review(ctx, threadId)
      .then((r) => {
        const quiet = r?.status === 'ok' && !r.added && !r.updated && !r.removed && !r.skill
        if (r && !quiet) onResult?.(describeReview(r))
      })
      .finally(() => this.reviewing.delete(id))
  }

  private async review(ctx: Ctx, threadId: string): Promise<ReviewResult | null> {
    if (!this.db.isOpen()) return null
    const recent = this.activeMessages(threadId, '9999').slice(-REVIEW_WINDOW)
    if (recent.length === 0) return null
    const existing = this.db.listMemories(ctx.agent.id, MAX_MEMORIES_IN_PROMPT)
    let tokens: number | undefined
    const raw = await runOneShot(
      ctx.adapter,
      ctx.config,
      ctx.agent.model,
      curatorPrompt(
        existing
          .map(
            (m) =>
              `(${short(m.id)}) [${m.kind === 'task' ? 'tarefa' : 'preferência'}] ${clip(oneLine(m.text), 300)}`,
          )
          .join('\n'),
        recent.map((m) => `[${m.role}] ${clip(oneLine(m.text), 600)}`).join('\n'),
      ),
      90_000,
      (u) => {
        tokens = u.inputTokens + u.outputTokens
      },
    )
    if (!raw || !this.db.isOpen())
      return { status: 'failed', added: 0, updated: 0, removed: 0, tokens }
    const plan = parseCuratorPlan(raw)
    if (!plan) return { status: 'failed', added: 0, updated: 0, removed: 0, tokens }
    const before = this.db.listMemories(ctx.agent.id, 10_000).length
    if (plan.fact) this.db.addMemory(ctx.agent.id, plan.fact.text, plan.fact.kind)
    const added = this.db.listMemories(ctx.agent.id, 10_000).length - before
    const updated =
      plan.update && this.db.updateMemory(ctx.agent.id, plan.update.id, plan.update.text) ? 1 : 0
    let removed = 0
    for (const id of plan.forget) if (this.db.deleteMemory(ctx.agent.id, id)) removed++
    let skill: string | undefined
    if (plan.skill) {
      try {
        skill = this.db.createSkillProposal({
          agentId: ctx.agent.id,
          slug: slugify(plan.skill.slug),
          name: plan.skill.slug,
          description: plan.skill.description,
          body: plan.skill.body,
        }).slug
      } catch {
        skill = undefined
      }
    }
    return { status: 'ok', added, updated, removed, skill, tokens }
  }

  private oneShot(
    { agent, adapter, config }: Ctx,
    prompt: string,
    timeoutMs = 90_000,
    signal?: AbortSignal,
  ) {
    return runOneShot(adapter, config, agent.model, prompt, timeoutMs, undefined, signal)
  }
}

/** Roda um turno único e sem ferramentas no provedor indicado; null em erro/timeout. */
export function runOneShot(
  adapter: ProviderAdapter,
  config: ProviderRuntimeConfig,
  model: string,
  prompt: string,
  timeoutMs = 90_000,
  onUsage?: (usage: TurnUsage) => void,
  signal?: AbortSignal,
): Promise<string | null> {
  return new Promise((resolve) => {
    let done = false
    let execution: { interrupt: () => void } | undefined
    const finish = (value: string | null) => {
      if (done) return
      done = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      resolve(value)
    }
    // Fecha primeiro: um interrupt() que entregue a resposta no mesmo instante não pode gravar o resumo.
    const onAbort = () => {
      finish(null)
      try {
        execution?.interrupt()
      } catch {
        // o processo do resumo já pode ter saído
      }
    }
    const timer = setTimeout(() => {
      try {
        execution?.interrupt()
      } catch {
        // o processo do resumo já pode ter saído
      }
      finish(null)
    }, timeoutMs)
    if (signal?.aborted) {
      finish(null)
      return
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    try {
      execution = adapter.executeTurn(
        prompt,
        { workspacePath: tmpdir(), model, providerConfig: { ...config, effort: undefined } },
        {
          onChunk: () => {},
          onDone: finish,
          onUsage,
          onError: () => finish(null),
          onInterrupted: () => finish(null),
          onPermissionRequest: () => Promise.resolve(undefined),
        },
      )
    } catch {
      finish(null)
    }
  })
}
