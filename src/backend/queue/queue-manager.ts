import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { RequestPermissionRequest } from '@agentclientprotocol/sdk'
import {
  type Agent,
  type Approval,
  type Message,
  type StreamChunkEvent,
  type TaskQueueItem,
  effectiveCapabilities,
} from '../../shared/types'
import {
  APPROVAL_INSTRUCTIONS,
  type RuntimeApprovalPayload,
  approvalAnswerPrompt,
  parseApprovalRequests,
  parseRuntimePayload,
  runtimeApprovalDonePrompt,
  runtimeApprovalText,
  stripApprovalRequests,
} from '../approvals/approval-protocol'
import { parseBrainDirectives, stripBrainDirectives } from '../brain/brain-protocol'
import { BrainService } from '../brain/brain-service'
import {
  type BrowserDirective,
  MAX_BROWSER_ROUNDS,
  argsFor,
  browserBatchNeedsApproval,
  buildBrowserInstructions,
  parseBrowserDirectives,
  stripBrowserDirectives,
  summarizeBrowserResult,
  toolNameFor,
} from '../browser/browser-protocol'
import {
  needsCollabFollowUp,
  parseCollabDirectives,
  stripCollabDirectives,
} from '../collaboration/collab-protocol'
import { CollaborationService, MAX_CHANNEL_DEPTH } from '../collaboration/collaboration-service'
import {
  type ComputerDirective,
  MAX_COMPUTER_ROUNDS,
  argsForComputer,
  buildComputerInstructions,
  computerBatchNeedsApproval,
  parseComputerDirectives,
  stripComputerDirectives,
} from '../computer/computer-protocol'
import { buildThreadContext, capRulesContent } from '../context/context-builder'
import { buildGitContext } from '../context/git-context'
import { claudeMcp, codexMcp } from '../mcp/mcp-launch'
import {
  needsMemoryFollowUp,
  parseMemoryDirectives,
  stripMemoryDirectives,
} from '../memory/memory-protocol'
import { MemoryService } from '../memory/memory-service'
import { isForeman, withForemanProject } from '../orchestration/foreman'
import {
  MAX_ORCHESTRATION_DEPTH,
  buildOrchestratorInstructions,
  parseDelegationDirectives,
  parseNewChatDirective,
  resolveDelegations,
  stripDelegationDirectives,
  stripNewChatDirectives,
  teamForOrchestrator,
} from '../orchestration/protocol'
import { resolveAccountRuntime } from '../providers/account-config'
import type { ProviderRegistry } from '../providers/registry'
import type { McpLaunchServer, TurnUsage } from '../providers/types'
import { loadWorkspaceRules } from '../rag/workspace-rules'
import {
  needsSkillFollowUp,
  parseSkillDirectives,
  stripSkillDirectives,
} from '../skills/skill-protocol'
import type { SkillService } from '../skills/skill-service'
import type { OrchbotDatabase } from '../storage/db'

export interface QueueManagerEvents {
  onPermissionRequest: (
    request: RequestPermissionRequest,
    signal: AbortSignal,
    agentName: string,
  ) => Promise<string | undefined>
  onStreamChunk: (event: StreamChunkEvent) => void
  onTurnFinished: (event: { threadId: string; message: Message; task: TaskQueueItem }) => void
  onTurnError: (event: { threadId: string; error: string; task: TaskQueueItem }) => void
  onTaskStatusChanged: (event: { task: TaskQueueItem }) => void
}

/** O que o terminal do CLI faz no modo cauteloso (os outros provedores seguem a própria configuração). */
const CAUTIOUS_TERMINAL: Partial<Record<string, string>> = {
  claude:
    '\nComando de terminal e edição de arquivo também param: cada um abre um pedido de permissão para a pessoa. Se ela recusar, não tente por outro caminho.',
  codex:
    '\nSeu terminal está só leitura. Para rodar algo que grava ou altera arquivos, peça com [[APROVAR]] dizendo o comando exato e pare. Depois do APROVADO, o terminal grava naquele turno.',
}

export function isQuotaOrRateLimitError(error: string): boolean {
  if (!error) return false
  const lower = error.toLowerCase()
  return (
    /\b429\b/.test(lower) ||
    lower.includes('too many requests') ||
    lower.includes('quota') ||
    lower.includes('rate_limit') ||
    lower.includes('rate limit') ||
    lower.includes('insufficient_quota') ||
    lower.includes('resource_exhausted') ||
    lower.includes('exceeded your current quota') ||
    lower.includes('tokens per min') ||
    lower.includes('requests per min')
  )
}

export type BrowserExecutor = (
  agentId: string,
  toolName: string,
  args: Record<string, unknown>,
) => Promise<unknown>

export type ComputerExecutor = (
  agentId: string,
  action: string,
  args: Record<string, unknown>,
) => Promise<string>

const MAX_MEMORY_ROUNDS = 3

export class QueueManager {
  private browserExecutor: BrowserExecutor | null = null
  private computerExecutor: ComputerExecutor | null = null
  private pausedAgents = new Set<string>()
  private isProcessingAgent = new Set<string>()
  /** Tarefas que retomam depois de uma aprovação em texto: no cauteloso, o Codex pode gravar só nelas. */
  private approvedTurns = new Set<string>()
  /** Tarefas que a pessoa escreveu: só depois delas o curador roda (é dali que vêm fato e preferência). */
  private personTurns = new Set<string>()
  private taskFallbackAttempts = new Map<string, Set<string>>()
  /** Resumo em curso, por agente. Pausa e cancelamento abortam e seguram a fila até ele parar. */
  private compactAbort = new Map<string, AbortController>()
  private isClosed = false
  public readonly memory: MemoryService
  public readonly brain: BrainService
  public readonly collab: CollaborationService
  private skills: SkillService | null = null
  /** Seções de continuação acumuladas por tarefa: uma resposta gera no máximo UM turno de continuação. */
  private followUps = new Map<string, string[]>()
  /** Qual contador essa continuação sobe. Memória não gasta navegador nem computador. */
  private followUpBump = new Map<string, { browser: boolean; computer: boolean; memory: boolean }>()
  private consentCheck: (() => boolean) | null = null

  constructor(
    private db: OrchbotDatabase,
    private registry: ProviderRegistry,
    private events?: Partial<QueueManagerEvents>,
  ) {
    this.memory = new MemoryService(db)
    this.brain = new BrainService(db)
    this.collab = new CollaborationService(db, {
      enqueue: (agentId, threadId, prompt, depth, origin) =>
        this.enqueue(agentId, threadId, prompt, depth, origin),
      cancelTask: (taskId) => this.cancel(taskId),
    })
    // Pausas sobrevivem a reinício; sem isso o agente pausado voltaria a rodar sozinho.
    for (const id of this.db.listPausedAgentIds()) this.pausedAgents.add(id)
    // Reconciliação imediata na inicialização
    this.reconcile()
  }

  public close(): void {
    this.isClosed = true
    for (const ctrl of this.compactAbort.values()) ctrl.abort()
  }

  public setEvents(events: QueueManagerEvents): void {
    this.events = events
  }

  public setBrowserExecutor(executor: BrowserExecutor): void {
    this.browserExecutor = executor
  }

  /** Retoma as filas após configurar o aceite; sem ele, tarefas continuam pendentes. */
  public setConsentCheck(check: () => boolean): void {
    this.consentCheck = check
    this.kick()
  }

  /** Reprocessa filas pendentes (ex.: logo após o aceite do aviso). */
  public kick(): void {
    for (const agent of this.db.listAgents())
      setTimeout(() => this.processNextForAgent(agent.id), 0)
  }

  public setSkills(skills: SkillService): void {
    this.skills = skills
  }

  public setComputerExecutor(executor: ComputerExecutor): void {
    this.computerExecutor = executor
  }

  public reconcile(): number {
    return this.db.reconcileRunningTasks()
  }

  public isPaused(agentId: string): boolean {
    return this.pausedAgents.has(agentId)
  }

  public pause(agentId: string): boolean {
    this.pausedAgents.add(agentId)
    this.db.setAgentPaused(agentId, true)
    this.compactAbort.get(agentId)?.abort()
    return true
  }

  public resume(agentId: string): boolean {
    this.pausedAgents.delete(agentId)
    this.db.setAgentPaused(agentId, false)
    // Tenta processar próxima tarefa pendente
    setTimeout(() => {
      this.processNextForAgent(agentId)
    }, 0)
    return true
  }

  /** A pessoa escreveu esta tarefa pela conversa: o curador revisa a memória depois do turno. */
  public markFromPerson(taskId: string): void {
    this.personTurns.add(taskId)
  }

  public enqueue(
    agentId: string,
    threadId: string,
    prompt: string,
    delegationDepth = 1,
    origin?: { originThreadId?: string; originAgentId?: string },
    browserRounds = 0,
    createdAt?: string,
    computerRounds = 0,
    memoryRounds = 0,
  ): TaskQueueItem {
    const task = this.db.enqueueTask(
      agentId,
      threadId,
      prompt,
      delegationDepth,
      origin,
      browserRounds,
      createdAt,
      computerRounds,
      memoryRounds,
    )
    this.events?.onTaskStatusChanged?.({ task })

    // Dispara processamento
    setTimeout(() => {
      this.processNextForAgent(agentId)
    }, 0)

    return task
  }

  /** Interrompe o turno ativo de uma thread (orientar enquanto trabalha). */
  public interruptThread(threadId: string): boolean {
    return this.registry.interruptThread(threadId)
  }

  public deleteThread(threadId: string): boolean {
    const thread = this.db.getThread(threadId)
    if (thread) {
      const tasks = this.listTasks(thread.agentId).filter((task) => task.threadId === threadId)
      for (const task of tasks) {
        if (task.status === 'pending') this.cancel(task.id)
      }
      for (const task of tasks) {
        if (task.status === 'running') this.cancel(task.id)
        this.personTurns.delete(task.id)
        this.approvedTurns.delete(task.id)
        this.followUps.delete(task.id)
        this.followUpBump.delete(task.id)
      }
    }
    return this.db.deleteThread(threadId)
  }

  /**
   * Para o CLI e a fila deste robô antes de apagar a linha.
   * Pendente primeiro, tudo síncrono: o processo, ao fechar, pede o próximo no tick seguinte.
   */
  public stopAgent(agentId: string): void {
    const tasks = this.listTasks(agentId)
    for (const task of tasks) {
      if (task.status === 'pending') this.cancel(task.id)
    }
    for (const thread of this.db.listThreads(agentId)) this.interruptThread(thread.id)
    for (const task of tasks) {
      if (task.status === 'running') this.cancel(task.id)
    }
    this.pausedAgents.add(agentId)
  }

  public cancel(taskId: string): boolean {
    const task = this.db.getTask(taskId)
    if (!task) return false

    // Compactação ainda não registrou o CLI do turno: segura a fila até o resumo parar sem gravar.
    const compacting = task.status === 'running' ? this.compactAbort.get(task.agentId) : undefined
    compacting?.abort()
    // Todo adaptador avisa onInterrupted ao fechar: se há execução registrada, ele libera o agente.
    const waitsForClose =
      task.status === 'running' &&
      (compacting !== undefined || this.registry.interruptThread(task.threadId))

    this.taskFallbackAttempts.delete(taskId)
    const updated = this.db.updateTaskStatus(taskId, 'cancelled', 'Cancelado pelo usuário')
    if (task.status === 'running' && !waitsForClose) this.isProcessingAgent.delete(task.agentId)
    this.events?.onTaskStatusChanged?.({ task: updated })

    // Processa próximo da fila se o cancelado estava rodando
    if (task.status === 'running' && !waitsForClose) {
      setTimeout(() => {
        this.processNextForAgent(task.agentId)
      }, 0)
    }

    return true
  }

  public retry(taskId: string): boolean {
    const task = this.db.getTask(taskId)
    if (!task) return false

    this.taskFallbackAttempts.delete(taskId)
    const updated = this.db.updateTaskStatus(taskId, 'pending', null)
    this.events?.onTaskStatusChanged?.({ task: updated })

    setTimeout(() => {
      this.processNextForAgent(task.agentId)
    }, 0)

    return true
  }

  public listTasks(agentId: string): TaskQueueItem[] {
    return this.db.listTasks(agentId)
  }

  /** `<pasta do projeto>/shared/`, criada na hora; null se o projeto não tem pasta. */
  private sharedDirFor(projectId: string | undefined): string | null {
    const root = projectId ? this.db.getProject(projectId)?.workspacePath : undefined
    if (!root) return null
    const dir = path.join(path.resolve(root), 'shared')
    try {
      fs.mkdirSync(dir, { recursive: true })
      return dir
    } catch {
      return null
    }
  }

  /** Executa os blocos [[COMPUTER:...]] e devolve o resultado ao robô. */
  private async dispatchComputerDirectives(
    task: TaskQueueItem,
    agentId: string,
    fullText: string,
  ): Promise<void> {
    const directives = parseComputerDirectives(fullText)
    if (directives.length === 0 || !this.computerExecutor) return
    const rounds = task.computerRounds ?? 0
    if (rounds >= MAX_COMPUTER_ROUNDS) {
      this.reportSpentRounds(
        task,
        'computer',
        rounds,
        directives.map((directive) => directive.action).join(', '),
      )
      return
    }

    const results = await this.collectComputerResults(agentId, directives)
    if (this.isClosed || !this.db.isOpen() || !this.db.getThread(task.threadId)) return
    const notice = this.db.addMessage(
      task.threadId,
      'system',
      `🖥️ Computador executou ${directives.length} comando(s). Lendo o resultado…`,
    )
    this.events?.onTurnFinished?.({ threadId: task.threadId, message: notice, task })

    this.addFollowUp(task, `[RESULTADO DO COMPUTADOR]\n${results.join('\n\n')}`, 'computer')
  }

  private async collectComputerResults(
    agentId: string,
    directives: ComputerDirective[],
  ): Promise<string[]> {
    if (!this.computerExecutor) return []
    const results: string[] = []
    for (const directive of directives) {
      try {
        const summary = await this.computerExecutor(
          agentId,
          directive.action,
          argsForComputer(directive),
        )
        results.push(`[${directive.action}] ${summary.slice(0, 1500)}`)
      } catch (err: unknown) {
        results.push(
          `[${directive.action}] Erro: ${err instanceof Error ? err.message : String(err)}`,
        )
      }
    }
    return results
  }

  private addFollowUp(
    task: TaskQueueItem,
    section: string,
    kind: 'browser' | 'computer' | 'memory',
  ): void {
    const list = this.followUps.get(task.id) ?? []
    list.push(section)
    this.followUps.set(task.id, list)
    const bump = this.followUpBump.get(task.id) ?? {
      browser: false,
      computer: false,
      memory: false,
    }
    bump[kind] = true
    this.followUpBump.set(task.id, bump)
  }

  /** O comando passou do limite: o robô lê isso no resultado. Uma repetição vira aviso e para. */
  private reportSpentRounds(
    task: TaskQueueItem,
    kind: 'browser' | 'computer',
    rounds: number,
    actions: string,
  ): void {
    const max = kind === 'browser' ? MAX_BROWSER_ROUNDS : MAX_COMPUTER_ROUNDS
    const label = kind === 'browser' ? 'navegador' : 'computador'
    const tag = kind === 'browser' ? '[RESULTADO DO NAVEGADOR]' : '[RESULTADO DO COMPUTADOR]'
    const line = `[${actions}] Limite de ${max} rodadas no ${label}. ${
      actions.includes(',') ? 'Estes comandos não rodaram.' : 'Este comando não rodou.'
    }`
    if (rounds === max) {
      this.addFollowUp(task, `${tag}\n${line}`, kind)
      return
    }
    const notice = this.db.addMessage(
      task.threadId,
      'system',
      `${kind === 'browser' ? '🌐' : '🖥️'} ${line}`,
    )
    this.events?.onTurnFinished?.({ threadId: task.threadId, message: notice, task })
  }

  /** Junta tudo que os despachantes pediram numa única mensagem de continuação. */
  private flushFollowUps(task: TaskQueueItem, agentId: string): boolean {
    const sections = this.followUps.get(task.id)
    const bump = this.followUpBump.get(task.id) ?? {
      browser: false,
      computer: false,
      memory: false,
    }
    this.followUps.delete(task.id)
    this.followUpBump.delete(task.id)
    if (!sections?.length || this.isClosed || !this.db.isOpen()) return false
    const pendingAt = this.db.getNextPendingTask(agentId)?.createdAt
    const pendingMs = pendingAt ? Date.parse(pendingAt) : Number.NaN
    // Quem escreveu enquanto a página abria já está na fila: a continuação entra 1 ms antes.
    this.enqueue(
      agentId,
      task.threadId,
      [
        sections.join('\n\n'),
        'Com base nisto, continue a tarefa e responda ao usuário. Só emita novos blocos se faltar algo essencial.',
      ].join('\n\n'),
      task.delegationDepth ?? 1,
      task.originThreadId
        ? { originThreadId: task.originThreadId, originAgentId: task.originAgentId }
        : undefined,
      (task.browserRounds ?? 0) + (bump.browser ? 1 : 0),
      Number.isFinite(pendingMs) ? new Date(pendingMs - 1).toISOString() : undefined,
      (task.computerRounds ?? 0) + (bump.computer ? 1 : 0),
      (task.memoryRounds ?? 0) + (bump.memory ? 1 : 0),
    )
    return true
  }

  /** Usuário respondeu um pedido de aprovação: o robô continua de onde parou. */
  public decideApproval(id: string, approved: boolean, note?: string): Approval {
    const approval = this.db.decideApproval(
      id,
      approved ? 'approved' : 'declined',
      note?.trim() || undefined,
    )
    const task = approval.taskId ? this.db.getTask(approval.taskId) : null
    this.db.addMessage(
      approval.threadId,
      'user',
      `${approved ? '✅ Aprovado' : '❌ Recusado'}: ${approval.text}${approval.note ? `\n${approval.note}` : ''}`,
    )
    const payload = approved ? parseRuntimePayload(approval.payloadJson) : undefined
    if (approved && approval.payloadJson) {
      if (payload) this.replayRuntimeApproval(approval, task, payload)
      else
        this.continueAfterApproval(
          approval,
          task,
          '[RESPOSTA DA APROVAÇÃO] APROVADO\nO pedido salvo não pôde ser executado. Não repita a ação por conta própria.',
        )
      return approval
    }
    const next = this.continueAfterApproval(approval, task, approvalAnswerPrompt(approval))
    if (approved) this.approvedTurns.add(next.id)
    return approval
  }

  /** Card de aprovação. payloadJson guarda as ações que o runtime executa depois do aprovado. */
  private openApproval(
    task: TaskQueueItem,
    agent: { id: string; name: string },
    text: string,
    payloadJson?: string,
  ): void {
    const approval = this.db.createApproval({
      agentId: agent.id,
      threadId: task.threadId,
      taskId: task.id,
      text,
      payloadJson,
    })
    const notice = this.db.addMessage(
      task.threadId,
      'system',
      `✋ ${agent.name} pede sua aprovação: ${approval.text.slice(0, 200)}`,
    )
    this.events?.onTurnFinished?.({ threadId: task.threadId, message: notice, task })
  }

  private continueAfterApproval(
    approval: Approval,
    task: TaskQueueItem | null,
    prompt: string,
    rounds?: { browser?: number; computer?: number; memory?: number },
  ): TaskQueueItem {
    return this.enqueue(
      approval.agentId,
      approval.threadId,
      prompt,
      task?.delegationDepth ?? 1,
      task?.originThreadId
        ? { originThreadId: task.originThreadId, originAgentId: task.originAgentId }
        : undefined,
      rounds?.browser ?? 0,
      undefined,
      rounds?.computer ?? 0,
      rounds?.memory ?? 0,
    )
  }

  /** Aprovado: executa o payload guardado e devolve o resultado. Não pede ao modelo para fazer de novo. */
  private replayRuntimeApproval(
    approval: Approval,
    task: TaskQueueItem | null,
    payload: RuntimeApprovalPayload,
  ): void {
    void this.runReplay(approval, task, payload).catch((err: unknown) => {
      if (this.isClosed || !this.db.isOpen()) return
      const message = err instanceof Error ? err.message : String(err)
      this.continueAfterApproval(
        approval,
        task,
        `[RESPOSTA DA APROVAÇÃO] APROVADO\nA ação foi aprovada, mas falhou ao executar: ${message}\nNão repita a ação por conta própria.`,
      )
    })
  }

  private async runReplay(
    approval: Approval,
    task: TaskQueueItem | null,
    payload: RuntimeApprovalPayload,
  ): Promise<void> {
    if (this.isClosed || !this.db.isOpen()) return
    const section = await this.replaySection(approval, task, payload)
    if (this.isClosed || !this.db.isOpen()) return
    const browser = task?.browserRounds ?? 0
    const computer = task?.computerRounds ?? 0
    this.continueAfterApproval(approval, task, runtimeApprovalDonePrompt(approval, section), {
      browser: payload.kind === 'browser' ? browser + 1 : browser,
      computer: payload.kind === 'computer' ? computer + 1 : computer,
      memory: task?.memoryRounds ?? 0,
    })
  }

  private async replaySection(
    approval: Approval,
    task: TaskQueueItem | null,
    payload: RuntimeApprovalPayload,
  ): Promise<string> {
    if (payload.kind === 'browser') {
      if (!this.browserExecutor) {
        return '[RESULTADO DO NAVEGADOR]\nO navegador não está disponível. A ação aprovada não rodou.'
      }
      const results = await this.collectBrowserResults(approval.agentId, payload.directives)
      this.postRuntimeNotice(
        task,
        approval.threadId,
        `🌐 Navegador executou ${payload.directives.length} comando(s). Lendo o resultado…`,
      )
      return `[RESULTADO DO NAVEGADOR]\n${results.join('\n\n')}`
    }
    if (!this.computerExecutor) {
      return '[RESULTADO DO COMPUTADOR]\nO uso do computador não está disponível. A ação aprovada não rodou.'
    }
    const results = await this.collectComputerResults(approval.agentId, payload.directives)
    this.postRuntimeNotice(
      task,
      approval.threadId,
      `🖥️ Computador executou ${payload.directives.length} comando(s). Lendo o resultado…`,
    )
    return `[RESULTADO DO COMPUTADOR]\n${results.join('\n\n')}`
  }

  private postRuntimeNotice(task: TaskQueueItem | null, threadId: string, text: string): void {
    const notice = this.db.addMessage(threadId, 'system', text)
    if (task) this.events?.onTurnFinished?.({ threadId, message: notice, task })
  }

  /** Cadeia: o resultado final de um pedido segue para o próximo robô configurado. */
  private handOff(task: TaskQueueItem, agent: Agent, result: string): void {
    const next = agent.handoffAgentId ? this.db.getAgent(agent.handoffAgentId) : null
    if (!next || next.id === agent.id || !result.trim() || this.isClosed || !this.db.isOpen())
      return
    const depth = (task.delegationDepth ?? 1) + 1
    const threadId = depth <= MAX_CHANNEL_DEPTH ? this.collab.latestThread(next.id) : undefined
    const text = threadId
      ? `⛓️ Resultado passado para ${next.name}.`
      : `⛓️ A cadeia parou em ${agent.name}: ${depth > MAX_CHANNEL_DEPTH ? 'limite de etapas atingido' : `${next.name} não tem conversa`}.`
    if (threadId) {
      const prompt = `[TRABALHO RECEBIDO DE ${agent.name}]\n${result.trim()}\n\nContinue a partir disto, fazendo a sua parte.`
      this.db.addMessage(threadId, 'user', prompt, agent.id, next.id)
      this.enqueue(next.id, threadId, prompt, depth)
    }
    const notice = this.db.addMessage(task.threadId, 'system', text)
    this.events?.onTurnFinished?.({ threadId: task.threadId, message: notice, task })
  }

  /** Executa [[SKILL:*]]; list e load voltam ao robô num novo turno. */
  private dispatchSkillDirectives(
    task: TaskQueueItem,
    agent: Agent,
    directives: ReturnType<typeof parseSkillDirectives>,
  ): void {
    if (!this.skills || directives.length === 0) return
    const rounds = task.memoryRounds ?? 0
    const lines = this.skills.run(agent, directives)
    if (!needsSkillFollowUp(directives) || rounds >= MAX_MEMORY_ROUNDS) {
      const notice = this.db.addMessage(
        task.threadId,
        'system',
        `🧩 ${lines.join(' ')}`.slice(0, 400),
      )
      this.events?.onTurnFinished?.({ threadId: task.threadId, message: notice, task })
      return
    }
    this.addFollowUp(task, `[RESULTADO DAS SKILLS]\n${lines.join('\n\n')}`, 'memory')
  }

  /** MCP escolhido para o agente (Claude e Codex). Segredos vão pelo ambiente, nunca no argv. */
  private mcpConfigFor(
    agent: Agent,
    task: TaskQueueItem,
  ): { mcpServers?: McpLaunchServer[]; extraEnv?: Record<string, string> } {
    // Antigravity também fala ACP (AntigravityAdapter estende AcpAdapter).
    const viaAcp = agent.provider === 'acp' || agent.provider === 'antigravity'
    if (agent.provider !== 'claude' && agent.provider !== 'codex' && !viaAcp) return {}
    try {
      const mcpServers = this.db.getAgentMcpLaunch(agent.id)
      if (mcpServers.length === 0) return {}
      // ACP leva os servidores no próprio protocolo (session/new): sem variáveis de ambiente.
      if (viaAcp) return { mcpServers }
      const { env } = (agent.provider === 'claude' ? claudeMcp : codexMcp)(mcpServers)
      return { mcpServers, extraEnv: env }
    } catch (err) {
      const notice = this.db.addMessage(
        task.threadId,
        'system',
        `🔌 MCP desativado neste turno: ${err instanceof Error ? err.message : String(err)}`,
      )
      this.events?.onTurnFinished?.({ threadId: task.threadId, message: notice, task })
      return {}
    }
  }

  /** Executa [[AGENT:*]] / [[CHANNEL:*]]; só `list` volta ao robô num novo turno. */
  private dispatchCollabDirectives(
    task: TaskQueueItem,
    agent: Agent,
    directives: ReturnType<typeof parseCollabDirectives>,
  ): void {
    if (directives.length === 0) return
    const rounds = task.memoryRounds ?? 0
    const { lines, followUp } = this.collab.run(
      agent,
      { threadId: task.threadId, depth: task.delegationDepth ?? 1 },
      directives,
    )
    if (!followUp || rounds >= MAX_MEMORY_ROUNDS) {
      const notice = this.db.addMessage(
        task.threadId,
        'system',
        `🤝 ${lines.join(' ')}`.slice(0, 400),
      )
      this.events?.onTurnFinished?.({ threadId: task.threadId, message: notice, task })
      return
    }
    this.addFollowUp(task, `[RESULTADO DOS AGENTES]\n${lines.join('\n\n')}`, 'memory')
  }

  /** Avisa ou devolve [[BRAIN:*]]. A gravação em si já aconteceu em `run`. */
  private deliverBrain(
    task: TaskQueueItem,
    directives: ReturnType<typeof parseBrainDirectives>,
    outcome: ReturnType<BrainService['run']>,
  ): void {
    if (directives.length === 0) return
    const rounds = task.memoryRounds ?? 0
    if (!outcome.followUp || rounds >= MAX_MEMORY_ROUNDS) {
      const notice = this.db.addMessage(
        task.threadId,
        'system',
        `🧠 ${outcome.lines.join(' ')}`.slice(0, 400),
      )
      this.events?.onTurnFinished?.({ threadId: task.threadId, message: notice, task })
      return
    }
    this.addFollowUp(task, `[RESULTADO DO CÉREBRO]\n${outcome.lines.join('\n\n')}`, 'memory')
  }

  /** Executa [[MEMORY:*]] / [[HISTORY:*]]; buscas e leituras voltam ao robô num novo turno. */
  private dispatchMemoryDirectives(
    task: TaskQueueItem,
    agentId: string,
    directives: ReturnType<typeof parseMemoryDirectives>,
  ): void {
    if (directives.length === 0) return
    const rounds = task.memoryRounds ?? 0
    const results = this.memory.run(agentId, directives)
    if (!needsMemoryFollowUp(directives) || rounds >= MAX_MEMORY_ROUNDS) {
      const notice = this.db.addMessage(
        task.threadId,
        'system',
        `🧠 ${results.join(' ')}`.slice(0, 300),
      )
      this.events?.onTurnFinished?.({ threadId: task.threadId, message: notice, task })
      return
    }
    this.addFollowUp(task, `[RESULTADO DA MEMÓRIA]\n${results.join('\n\n')}`, 'memory')
  }

  /** Executa os blocos [[BROWSER:...]] do turno e devolve o resultado ao robô. */
  private async dispatchBrowserDirectives(
    task: TaskQueueItem,
    agentId: string,
    fullText: string,
  ): Promise<void> {
    const directives = parseBrowserDirectives(fullText)
    if (directives.length === 0) return

    if (!this.browserExecutor) {
      const notice = this.db.addMessage(
        task.threadId,
        'system',
        '🌐 O robô pediu o navegador, mas o navegador embutido não está disponível nesta sessão.',
      )
      this.events?.onTurnFinished?.({ threadId: task.threadId, message: notice, task })
      return
    }

    const rounds = task.browserRounds ?? 0
    if (rounds >= MAX_BROWSER_ROUNDS) {
      this.reportSpentRounds(
        task,
        'browser',
        rounds,
        directives.map((directive) => directive.action).join(', '),
      )
      return
    }

    const results = await this.collectBrowserResults(agentId, directives)
    if (this.isClosed || !this.db.isOpen() || !this.db.getThread(task.threadId)) return

    const notice = this.db.addMessage(
      task.threadId,
      'system',
      `🌐 Navegador executou ${directives.length} comando(s). Lendo o resultado…`,
    )
    this.events?.onTurnFinished?.({ threadId: task.threadId, message: notice, task })

    this.addFollowUp(task, `[RESULTADO DO NAVEGADOR]\n${results.join('\n\n')}`, 'browser')
  }

  private async collectBrowserResults(
    agentId: string,
    directives: BrowserDirective[],
  ): Promise<string[]> {
    if (!this.browserExecutor) return []
    const results: string[] = []
    for (const directive of directives) {
      try {
        const result = await this.browserExecutor(
          agentId,
          toolNameFor(directive.action),
          argsFor(directive),
        )
        results.push(`[${directive.action}] ${summarizeBrowserResult(directive.action, result)}`)
      } catch (err: unknown) {
        results.push(
          `[${directive.action}] Erro: ${err instanceof Error ? err.message : String(err)}`,
        )
      }
    }
    return results
  }

  /** Orquestrador delegou: enfileira nos especialistas e avisa na conversa dele. */
  private dispatchDelegations(
    orchestratorTask: TaskQueueItem,
    orchestrator: { id: string; name: string },
    fullText: string,
  ): void {
    const depth = orchestratorTask.delegationDepth ?? 1
    if (depth >= MAX_ORCHESTRATION_DEPTH) return
    const directives = parseDelegationDirectives(fullText)
    if (directives.length === 0) return

    const orch = this.db.getAgent(orchestrator.id)
    if (!orch) return
    const team = teamForOrchestrator(
      withForemanProject(orch, this.db.getThread(orchestratorTask.threadId)?.projectId),
      this.db.listAgents(),
    )
    const { resolved, unknownTargets } = resolveDelegations(directives, team)
    const notices: string[] = []

    for (const item of resolved) {
      const targetThreadId = this.collab.latestThread(item.agent.id)
      if (!targetThreadId) {
        notices.push(`⚠️ ${item.agent.name} não tem conversa disponível.`)
        continue
      }
      const delegationPrompt = `[Tarefa Delegada por ${orchestrator.name}]:\n${item.task}`
      this.db.addMessage(targetThreadId, 'user', delegationPrompt, orchestrator.id, item.agent.id)
      this.enqueue(item.agent.id, targetThreadId, delegationPrompt, depth + 1, {
        originThreadId: orchestratorTask.threadId,
        originAgentId: orchestrator.id,
      })
      notices.push(`🤝 Delegado para ${item.agent.name}: ${item.task.slice(0, 120)}`)
    }
    for (const target of unknownTargets) {
      notices.push(`⚠️ Especialista não encontrado: "${target}".`)
    }

    if (notices.length > 0) {
      const notice = this.db.addMessage(orchestratorTask.threadId, 'system', notices.join('\n'))
      this.events?.onTurnFinished?.({
        threadId: orchestratorTask.threadId,
        message: notice,
        task: orchestratorTask,
      })
    }
  }

  /** Especialista terminou: devolve o resultado ao orquestrador resumir. */
  private returnResultToOrchestrator(
    task: TaskQueueItem,
    workerName: string,
    result: string,
  ): void {
    if (!task.originThreadId || !task.originAgentId) return
    if (!this.db.getThread(task.originThreadId)) return
    const originAgent = this.db.getAgent(task.originAgentId)
    if (!originAgent) return
    // Canal: o dono pode seguir coordenando (a profundidade continua subindo até MAX_CHANNEL_DEPTH).
    const inChannel = Boolean(this.db.getChannelByThread(task.originThreadId))
    const prompt = [
      `[RESULTADO DO ESPECIALISTA ${workerName}]`,
      result,
      '',
      inChannel
        ? 'Continue coordenando a tarefa do canal: peça a próxima etapa se faltar algo, ou entregue o resultado final ao usuário.'
        : 'Resuma este resultado para o usuário e diga os próximos passos, se houver. Não emita blocos de delegação nesta resposta.',
    ].join('\n')
    this.db.addMessage(task.originThreadId, 'system', `📥 Resultado de ${workerName} recebido.`)
    this.enqueue(
      task.originAgentId,
      task.originThreadId,
      prompt,
      inChannel ? (task.delegationDepth ?? 1) : MAX_ORCHESTRATION_DEPTH,
    )
  }

  /** A espera antes do CLI (resumo ou git) não deve mais virar um turno. */
  private preTurnStopped(agentId: string, taskId: string): boolean {
    if (this.isClosed || !this.db.isOpen()) return true
    if (this.pausedAgents.has(agentId)) return true
    return this.db.getTask(taskId)?.status !== 'running'
  }

  /** Solta o robô. Na pausa a tarefa volta para a fila; no cancelamento o próximo pedido segue. */
  private abandonPreTurn(agentId: string, taskId: string): void {
    this.isProcessingAgent.delete(agentId)
    if (this.isClosed || !this.db.isOpen()) return
    const task = this.db.getTask(taskId)
    if (this.pausedAgents.has(agentId) && task?.status === 'running') {
      const pending = this.db.updateTaskStatus(taskId, 'pending', null)
      this.events?.onTaskStatusChanged?.({ task: pending })
      return
    }
    if (!this.pausedAgents.has(agentId)) setTimeout(() => this.processNextForAgent(agentId), 0)
  }

  /** Solta o robô só depois que o acompanhamento (página, clique, memória) já está na fila. */
  private finishAgentTurn(agentId: string): void {
    this.isProcessingAgent.delete(agentId)
    if (this.isClosed || !this.db.isOpen()) return
    setTimeout(() => this.processNextForAgent(agentId), 0)
  }

  private async processNextForAgent(agentId: string): Promise<void> {
    if (this.isClosed || !this.db.isOpen()) {
      return
    }

    if (this.pausedAgents.has(agentId)) {
      return
    }

    if (this.consentCheck && !this.consentCheck()) {
      return
    }

    if (this.isProcessingAgent.has(agentId)) {
      return
    }

    const nextTask = this.db.getNextPendingTask(agentId)
    if (!nextTask) {
      return
    }

    this.isProcessingAgent.add(agentId)

    // Atualiza para status 'running'
    const runningTask = this.db.updateTaskStatus(nextTask.id, 'running')
    this.events?.onTaskStatusChanged?.({ task: runningTask })

    const agent = this.db.getAgent(agentId)
    if (!agent) {
      this.isProcessingAgent.delete(agentId)
      const failed = this.db.updateTaskStatus(nextTask.id, 'failed', 'Agente não encontrado')
      this.events?.onTaskStatusChanged?.({ task: failed })
      return
    }

    let runtime: ReturnType<typeof resolveAccountRuntime>
    try {
      runtime = resolveAccountRuntime(this.db, agent.provider, agent.accountId)
    } catch (err) {
      this.taskFallbackAttempts.delete(nextTask.id)
      const error = err instanceof Error ? err.message : 'Falha ao abrir a conta do provedor'
      this.isProcessingAgent.delete(agentId)
      const failed = this.db.updateTaskStatus(nextTask.id, 'failed', error)
      this.events?.onTaskStatusChanged?.({ task: failed })
      this.events?.onTurnError?.({ threadId: nextTask.threadId, error, task: failed })
      if (nextTask.originThreadId) this.returnResultToOrchestrator(nextTask, agent.name, error)
      setTimeout(() => this.processNextForAgent(agentId), 50)
      return
    }
    const speaker = withForemanProject(agent, this.db.getThread(nextTask.threadId)?.projectId)
    const { connection, account, config } = runtime
    const apiKey = config.apiKey
    const adapter = this.registry.getAdapter(agent.provider)

    const sessionScope = createHash('sha256')
      .update(
        JSON.stringify([
          path.resolve(agent.workspacePath),
          connection?.cliPath ?? '',
          connection?.endpoint ?? '',
          apiKey ?? '',
          ...(!account.isDefault ? [account.id, config.cliProfile?.directory ?? ''] : []),
        ]),
      )
      .digest('hex')
    // Git e compactação em paralelo. O resumo só é gravado se o turno ainda for seguir depois das duas.
    const gitPromise = this.db.getSettings().gitContext
      ? buildGitContext(agent.workspacePath, agent.contextMode ?? 'padrao').catch(() => null)
      : Promise.resolve(null)
    const compactCtrl = new AbortController()
    this.compactAbort.set(agentId, compactCtrl)
    let markCompactReady = () => {}
    const compactReady = new Promise<void>((resolve) => {
      markCompactReady = () => {
        resolve()
      }
    })
    const compactPromise = this.memory
      .compactIfNeeded(
        { agent, adapter, config },
        nextTask.threadId,
        nextTask.createdAt,
        sessionScope,
        {
          signal: compactCtrl.signal,
          ready: compactReady,
        },
      )
      .catch(() => undefined)
    let git: string | null = null
    let compactNotice: string | undefined
    try {
      git = await gitPromise
      if (this.preTurnStopped(agentId, nextTask.id)) compactCtrl.abort()
      markCompactReady()
      compactNotice = await compactPromise
      if (this.preTurnStopped(agentId, nextTask.id)) {
        this.abandonPreTurn(agentId, nextTask.id)
        return
      }
    } finally {
      markCompactReady()
      this.compactAbort.delete(agentId)
    }
    if (compactNotice) {
      const notice = this.db.addMessage(nextTask.threadId, 'system', compactNotice)
      this.events?.onTurnFinished?.({
        threadId: nextTask.threadId,
        message: notice,
        task: nextTask,
      })
    }
    const resumeSessionId = adapter.supportsSessionResume
      ? this.db.getProviderSession(nextTask.threadId, agent.provider, sessionScope)
      : undefined

    // 1. Diretrizes do Projeto (ORCHBOT.md / AGENTS.md)
    const rules = loadWorkspaceRules(agent.workspacePath)
    const contextSections: string[] = []

    if (rules.exists && rules.content) {
      contextSections.push(
        `[DIRETRIZES DO PROJETO (${rules.filename})]\n${capRulesContent(rules.content, agent.contextMode ?? 'padrao')}`,
      )
    }

    // 1b. Estado do repositório git do workspace (barato e útil para agentes de código)
    if (git) contextSections.push(git)

    // 2. Memória Contínua FTS5 (histórico de conversas anteriores relevantes)
    try {
      const relevantMsgs = this.db.searchMessages(nextTask.prompt, {
        agentId,
        limit: 3,
      })
      const filteredMsgs = relevantMsgs.filter(
        (m) =>
          m.text.trim() !== nextTask.prompt.trim() &&
          (!resumeSessionId || m.threadId !== nextTask.threadId),
      )
      if (filteredMsgs.length > 0) {
        const memoryText = filteredMsgs
          .map((m) => `- [Conversa "${m.threadTitle}" (${m.role})]: ${m.text.slice(0, 300)}`)
          .join('\n')
        contextSections.push(
          `[MEMÓRIA DO PROJETO / HISTÓRICO DE CONVERSAS ANTERIORES]\n${memoryText}`,
        )
      }
    } catch {
      // Ignora falhas de busca de memória
    }

    // 3. Trechos relevantes do repositório (RAG local)
    try {
      const relevantFiles = this.db.searchWorkspaceFiles(agentId, nextTask.prompt, 3)
      if (relevantFiles.length > 0) {
        const filesText = relevantFiles
          .map((f) => `- [Arquivo ${f.fileName}]: ${f.snippet.replace(/<\/?b>/g, '')}`)
          .join('\n')
        contextSections.push(`[TRECHOS RELEVANTES DO REPOSITÓRIO]\n${filesText}`)
      }
    } catch {
      // Ignora falhas de busca em arquivos
    }

    if (!resumeSessionId) {
      const messages = this.db
        .listMessages(nextTask.threadId)
        .filter((message) => message.createdAt <= nextTask.createdAt)
      const currentMessage = messages.findLastIndex(
        (message) =>
          message.role === 'user' &&
          (message.text.trim() === nextTask.prompt.trim() ||
            nextTask.prompt.startsWith(`${message.text.trim()}\n\n[Arquivos anexados`)),
      )
      const history =
        currentMessage >= 0
          ? messages.slice(0, currentMessage)
          : messages.filter((message) => message.createdAt < nextTask.createdAt)
      const compacted = this.db.getThreadSummary(nextTask.threadId)
      const bootstrap = buildThreadContext(
        compacted ? this.memory.afterSummary(nextTask.threadId, history) : history,
        agent.contextMode ?? 'padrao',
        compacted?.summary,
      )
      if (bootstrap.text) contextSections.push(bootstrap.text)
    }

    // 4. Instruções originais do agente
    if (agent.instructions?.trim()) {
      contextSections.push(`[INSTRUÇÕES DO AGENTE]\n${agent.instructions.trim()}`)
    }

    // 4b. Pasta compartilhada do projeto: todos leem e escrevem, sem copiar entre workspaces
    const sharedDir = this.sharedDirFor(speaker.projectId)
    if (sharedDir) {
      contextSections.push(
        `[PASTA COMPARTILHADA DO PROJETO]\n${sharedDir}\nTodo colega deste projeto lê e escreve aqui. Para passar um arquivo a alguém, salve nesta pasta e diga o nome, sem mandar cópia.`,
      )
    }

    // 5. Nível de Autonomia do Agente
    if (agent.autonomyLevel === 'cautious') {
      contextSections.push(
        `[NÍVEL DE AUTONOMIA: 🛡️ MODO CAUTELOSO]\nVocê está operando em Modo Cauteloso. Clique, preenchimento e fechar aba no navegador, e abrir app, clicar, digitar e teclas no computador, ficam parados: o Orchbot abre um card e só executa depois que a pessoa aprovar, mesmo que você não peça. Pode ler na hora (abrir página, inspecionar, screenshot, listar janelas). Para e-mail, publicar, pagar ou apagar fora desses comandos, use o bloco [[APROVAR]] e pare.${CAUTIOUS_TERMINAL[agent.provider] ?? ''}`,
      )
    } else {
      contextSections.push(
        '[NÍVEL DE AUTONOMIA: ⚡ MODO AUTÔNOMO]\nVocê está operando em Modo Autônomo. Execute as tarefas e subtarefas da fila sequencialmente até concluir o objetivo com precisão.',
      )
    }

    contextSections.push(APPROVAL_INSTRUCTIONS)

    // 6. Papel de orquestrador: equipe + protocolo de delegação
    if (speaker.role === 'orchestrator') {
      const team = teamForOrchestrator(speaker, this.db.listAgents())
      contextSections.push(buildOrchestratorInstructions(speaker, team))
    }

    // 6b. Capacidades (padrão do computador + override do robô)
    const caps = effectiveCapabilities(agent, this.db.getSettings())
    contextSections.push(
      caps.localScripts
        ? '[SCRIPTS LOCAIS] Você pode executar scripts locais e comandos do workspace quando isso ajudar a tarefa (com responsabilidade e sem apagar dados sem confirmação).'
        : '[SCRIPTS LOCAIS] Scripts locais estão desligados para você: não execute comandos/scripts do computador; trabalhe apenas com análise e texto.',
    )
    if (caps.showPlanBeforeLongTasks) {
      contextSections.push(
        '[PLANO ANTES DE TAREFAS LONGAS] Se a tarefa for longa ou em várias etapas, comece a resposta apresentando um plano curto (até 6 passos numerados) e só então execute.',
      )
    }
    if (caps.startsNewChats) {
      contextSections.push(
        '[NOVOS CHATS] Você pode iniciar uma conversa nova para um tópico separado, no máximo 1 por turno: [[NOVO-CHAT:Título do tópico]] tarefa inicial completa [[/NOVO-CHAT]]',
      )
    }

    // 6c. Uso do computador (padrão do computador + override do robô)
    if (caps.computerUse) {
      contextSections.push(buildComputerInstructions(agent.name))
    }

    // 6d. Cérebro do projeto (fato da empresa) e memória só do robô
    const brainSection = this.brain.contextSection(speaker)
    if (brainSection) contextSections.push(brainSection)
    contextSections.push(...this.memory.contextSections(agentId))
    contextSections.push(...this.collab.contextSections(agent, nextTask.threadId))
    if (this.skills) contextSections.push(this.skills.contextSection(agentId))

    // 7. Navegador embutido do robô
    if (agent.browserAccess !== false) {
      contextSections.push(buildBrowserInstructions(agent.name))
    }

    const effectiveInstructions =
      contextSections.length > 0 ? contextSections.join('\n\n') : undefined

    // Uso de tokens informado pela CLI neste turno (gravado junto da resposta).
    let turnUsage: TurnUsage | undefined
    let nativeSessionId: string | undefined
    let settled = false
    const permission =
      agent.autonomyLevel === 'cautious'
        ? this.approvedTurns.has(nextTask.id)
          ? ('approved' as const)
          : ('ask' as const)
        : undefined
    this.approvedTurns.delete(nextTask.id)
    const execution = adapter.executeTurn(
      nextTask.prompt,
      {
        workspacePath: agent.workspacePath,
        extraDirs: sharedDir ? [sharedDir] : undefined,
        permission: permission,
        resumeSessionId,
        model: agent.model,
        instructions: effectiveInstructions,
        providerConfig: {
          ...config,
          effort: agent.effort ?? connection.effort,
          ...this.mcpConfigFor(agent, nextTask),
        },
      },
      {
        onUsage: (usage) => {
          turnUsage = usage
        },
        onNotice: (text) => {
          if (
            settled ||
            this.isClosed ||
            !this.db.isOpen() ||
            !this.db.getThread(nextTask.threadId)
          )
            return
          const notice = this.db.addMessage(nextTask.threadId, 'system', text)
          this.events?.onTurnFinished?.({
            threadId: nextTask.threadId,
            message: notice,
            task: nextTask,
          })
        },
        onSessionId: (sessionId) => {
          nativeSessionId = sessionId
          if (!this.isClosed && this.db.isOpen() && this.db.getThread(nextTask.threadId))
            this.db.saveProviderSession(nextTask.threadId, agent.provider, sessionScope, sessionId)
        },
        onInterrupted: () => {
          if (settled) return
          settled = true
          this.taskFallbackAttempts.delete(nextTask.id)
          if (this.isClosed || !this.db.isOpen()) return
          this.registry.removeActiveExecution(nextTask.threadId)
          this.isProcessingAgent.delete(agentId)
          const current = this.db.getTask(nextTask.id)
          if (current?.status === 'running') {
            const interrupted = this.db.updateTaskStatus(
              nextTask.id,
              'interrupted',
              'Interrompido pelo usuário',
            )
            this.events?.onTaskStatusChanged?.({ task: interrupted })
          }
          setTimeout(() => this.processNextForAgent(agentId), 0)
        },
        onPermissionRequest: (request, signal) => {
          if (
            settled ||
            this.isClosed ||
            !this.db.isOpen() ||
            !this.db.getThread(nextTask.threadId)
          )
            return Promise.resolve(undefined)
          return (
            this.events?.onPermissionRequest?.(request, signal, agent.name) ??
            Promise.resolve(undefined)
          )
        },
        onChunk: (chunk, fullText) => {
          if (
            settled ||
            this.isClosed ||
            !this.db.isOpen() ||
            !this.db.getThread(nextTask.threadId)
          )
            return
          this.events?.onStreamChunk?.({
            threadId: nextTask.threadId,
            chunk,
            fullText,
          })
        },
        onError: (rawError) => {
          if (settled) return
          settled = true
          const error = apiKey ? rawError.split(apiKey).join('[REDACTED]') : rawError
          if (this.isClosed || !this.db.isOpen()) return
          if (!this.db.getThread(nextTask.threadId)) {
            this.taskFallbackAttempts.delete(nextTask.id)
            this.registry.removeActiveExecution(nextTask.threadId)
            this.finishAgentTurn(agentId)
            return
          }
          // Failover transparente de cota (429 Too Many Requests / Quota Exceeded)
          if (isQuotaOrRateLimitError(error)) {
            const tried = this.taskFallbackAttempts.get(nextTask.id) ?? new Set<string>()
            tried.add(account.id)
            this.taskFallbackAttempts.set(nextTask.id, tried)

            const enabledConnections = this.db.listConnections().filter((c) => c.enabled)
            const sameProvider = this.db.getConnection(agent.provider)?.enabled
              ? this.db
                  .listProviderAccounts(agent.provider)
                  .find((candidate) => candidate.enabled && !tried.has(candidate.id))
              : undefined
            const fallback =
              sameProvider ??
              enabledConnections
                .filter((candidate) => candidate.providerId !== agent.provider)
                .flatMap((candidate) => this.db.listProviderAccounts(candidate.providerId))
                .find((candidate) => candidate.enabled && !tried.has(candidate.id))

            if (fallback) {
              this.registry.removeActiveExecution(nextTask.threadId)
              this.isProcessingAgent.delete(agentId)
              const fallbackConnection = this.db.getConnection(fallback.providerId)
              if (!fallbackConnection) return
              const failoverNotice = `⚠️ Cota ou limite excedido em ${agent.provider.toUpperCase()} / ${account.label} (${error}). Tentando ${fallback.providerId.toUpperCase()} / ${fallback.label}.`
              const systemMsg = this.db.addMessage(nextTask.threadId, 'system', failoverNotice)
              this.events?.onTurnFinished?.({
                threadId: nextTask.threadId,
                message: systemMsg,
                task: nextTask,
              })
              this.db.updateAgent({
                id: agent.id,
                provider: fallback.providerId,
                accountId: fallback.id,
                model:
                  fallback.providerId === agent.provider
                    ? agent.model
                    : fallbackConnection.defaultModel,
              })

              // 3. Reseta status da tarefa para pendente
              this.db.updateTaskStatus(nextTask.id, 'pending')

              // 4. Continua a execução imediatamente com o novo provedor
              setTimeout(() => {
                this.processNextForAgent(agentId)
              }, 50)
              return
            }
          }

          // Se não houver fallback habilitado ou não for erro de cota
          this.taskFallbackAttempts.delete(nextTask.id)
          this.registry.removeActiveExecution(nextTask.threadId)
          this.isProcessingAgent.delete(agentId)

          if (nextTask.originThreadId) {
            this.returnResultToOrchestrator(
              nextTask,
              agent.name,
              `O especialista falhou ao executar a tarefa: ${error}`,
            )
          }

          const failedTask = this.db.updateTaskStatus(nextTask.id, 'failed', error)
          this.events?.onTaskStatusChanged?.({ task: failedTask })
          this.events?.onTurnError?.({
            threadId: nextTask.threadId,
            error,
            task: failedTask,
          })

          // Continua processando a fila do agente
          setTimeout(() => {
            this.processNextForAgent(agentId)
          }, 50)
        },
        onDone: (fullText) => {
          if (settled) return
          settled = true
          if (this.isClosed || !this.db.isOpen() || !this.db.getThread(nextTask.threadId)) {
            this.taskFallbackAttempts.delete(nextTask.id)
            this.registry.removeActiveExecution(nextTask.threadId)
            this.finishAgentTurn(agentId)
            return
          }
          this.taskFallbackAttempts.delete(nextTask.id)
          this.registry.removeActiveExecution(nextTask.threadId)
          let followUpScheduled = false
          try {
            // Orquestração: remove os blocos de delegação do texto visível
            const isOrchestrator = agent.role === 'orchestrator'
            const fullForDirectives = fullText
            const memoryDirectives = parseMemoryDirectives(fullText)
            const brainDirectives = parseBrainDirectives(fullText)
            const brainOutcome = this.brain.run(speaker, brainDirectives)
            const collabDirectives = parseCollabDirectives(fullText)
            const skillDirectives = this.skills ? parseSkillDirectives(fullText) : []
            const approvalRequests = parseApprovalRequests(fullText)
            const stripped = stripApprovalRequests(
              stripSkillDirectives(
                stripCollabDirectives(
                  stripBrainDirectives(
                    stripMemoryDirectives(
                      stripComputerDirectives(
                        stripNewChatDirectives(stripBrowserDirectives(fullText)),
                      ),
                    ),
                  ),
                ),
              ),
            )
            const visibleText = isOrchestrator ? stripDelegationDirectives(stripped) : stripped
            const browserDirectives = parseBrowserDirectives(fullText)
            const computerDirectives = parseComputerDirectives(fullText)
            const capsNow = effectiveCapabilities(agent, this.db.getSettings())
            // shortcut: shell do Codex/Claude não passa por aqui, só browser e COMPUTER (open via shell). Segure igual quando o adaptador expuser o pedido.
            const holdBrowser =
              agent.autonomyLevel === 'cautious' &&
              agent.browserAccess !== false &&
              this.browserExecutor !== null &&
              browserBatchNeedsApproval(browserDirectives)
            const holdComputer =
              agent.autonomyLevel === 'cautious' &&
              capsNow.computerUse &&
              this.computerExecutor !== null &&
              computerBatchNeedsApproval(computerDirectives)

            // 1. Grava a mensagem do assistente no histórico do chat
            const assistantMsg = this.db.addMessage(
              nextTask.threadId,
              'assistant',
              visibleText.trim() ||
                (approvalRequests.length > 0 || holdBrowser || holdComputer
                  ? '✋ Preciso da sua aprovação antes de continuar.'
                  : brainDirectives.length > 0 &&
                      memoryDirectives.length === 0 &&
                      collabDirectives.length === 0 &&
                      skillDirectives.length === 0
                    ? '🧠 Consultei o cérebro do projeto.'
                    : memoryDirectives.length > 0 ||
                        collabDirectives.length > 0 ||
                        skillDirectives.length > 0
                      ? '🧠 Consultando a memória…'
                      : browserDirectives.length > 0
                        ? '🌐 Consultando o navegador…'
                        : isOrchestrator
                          ? 'Deleguei as subtarefas aos especialistas. Assim que responderem, eu resumo aqui.'
                          : '(Nenhum conteúdo retornado)'),
            )

            // 1a. Pedido de aprovação: texto [[APROVAR]] ou ação mutável no modo cauteloso.
            for (const text of approvalRequests) this.openApproval(nextTask, agent, text)
            if (holdBrowser) {
              const payload: RuntimeApprovalPayload = {
                kind: 'browser',
                directives: browserDirectives,
              }
              this.openApproval(
                nextTask,
                agent,
                runtimeApprovalText(payload),
                JSON.stringify(payload),
              )
            }
            if (holdComputer) {
              const payload: RuntimeApprovalPayload = {
                kind: 'computer',
                directives: computerDirectives,
              }
              this.openApproval(
                nextTask,
                agent,
                runtimeApprovalText(payload),
                JSON.stringify(payload),
              )
            }
            const waitingApproval = this.db
              .listPendingApprovals()
              .some((item) => item.threadId === nextTask.threadId)

            if (turnUsage)
              this.db.setMessageUsage(
                assistantMsg.id,
                this.db.perTurnUsage(
                  nextTask.threadId,
                  nativeSessionId ?? resumeSessionId,
                  turnUsage,
                ),
                nativeSessionId ?? resumeSessionId,
              )

            // 1b. Orquestrador delega aos especialistas; especialista devolve ao orquestrador
            if (isOrchestrator) {
              this.dispatchDelegations(nextTask, agent, fullText)
            }

            // 1c. Comandos de navegador do robô (vale para qualquer papel)
            const followUpWork: Promise<void>[] = []
            if (agent.browserAccess !== false && !holdBrowser) {
              followUpWork.push(this.dispatchBrowserDirectives(nextTask, agentId, fullText))
            }

            // 1c0. Canal: a resposta do agente vai para o log compartilhado
            {
              const inChannel = this.db.getChannelByThread(nextTask.threadId)
              if (inChannel && visibleText.trim())
                this.db.addChannelMessage(inChannel.channel.id, agentId, visibleText.trim())
            }

            // 1c0b. Conversa entre agentes e pedidos dentro de canais
            this.dispatchCollabDirectives(nextTask, agent, collabDirectives)

            // 1c0c. Skills
            this.dispatchSkillDirectives(nextTask, agent, skillDirectives)

            // 1c1. Cérebro do projeto, memória e histórico locais
            this.deliverBrain(nextTask, brainDirectives, brainOutcome)
            this.dispatchMemoryDirectives(nextTask, agentId, memoryDirectives)
            if (this.personTurns.delete(nextTask.id))
              this.memory.maybeReview({ agent, adapter, config }, nextTask.threadId, (text) => {
                if (this.isClosed || !this.db.isOpen() || !this.db.getThread(nextTask.threadId))
                  return
                const notice = this.db.addMessage(nextTask.threadId, 'system', text)
                this.events?.onTurnFinished?.({
                  threadId: nextTask.threadId,
                  message: notice,
                  task: nextTask,
                })
              })

            // 1c2. Uso do computador. No modo cauteloso, lote com ação mutável espera o card.
            if (capsNow.computerUse && !holdComputer) {
              followUpWork.push(this.dispatchComputerDirectives(nextTask, agentId, fullText))
            }
            // Cadeia só no fim de um pedido do usuário/rotina/webhook: não em delegações,
            // canais, mensagens diretas, nem enquanto espera aprovação ou especialistas.
            const canHandOff =
              !!agent.handoffAgentId &&
              !waitingApproval &&
              !nextTask.originThreadId &&
              !nextTask.prompt.startsWith('[Mensagem direta de') &&
              !(isOrchestrator && parseDelegationDirectives(fullText).length > 0) &&
              !this.db.getChannelByThread(nextTask.threadId)
            void Promise.allSettled(followUpWork).then(() => {
              try {
                if (this.isClosed || !this.db.isOpen() || !this.db.getThread(nextTask.threadId))
                  return
                if (this.flushFollowUps(nextTask, agentId)) return
                // Sem continuação agendada (inclusive no limite de rodadas): devolve o resultado.
                if (!isOrchestrator && nextTask.originThreadId && !waitingApproval) {
                  const specialistText = brainDirectives.length
                    ? [stripBrainDirectives(fullText).trim(), brainOutcome.lines.join('\n')]
                        .filter(Boolean)
                        .join('\n\n')
                    : fullText.trim()
                  this.returnResultToOrchestrator(nextTask, agent.name, specialistText)
                }
                if (canHandOff) this.handOff(nextTask, agent, visibleText)
              } finally {
                this.finishAgentTurn(agentId)
              }
            })
            followUpScheduled = true

            // 1d. Robô inicia um novo chat (quando a capacidade permite)
            {
              const caps = effectiveCapabilities(agent, this.db.getSettings())
              const newChat = caps.startsNewChats ? parseNewChatDirective(fullForDirectives) : null
              if (newChat) {
                const thread = this.db.createThread(
                  agentId,
                  newChat.title,
                  isForeman(agent) ? this.db.getThread(nextTask.threadId)?.projectId : undefined,
                )
                this.db.addMessage(thread.id, 'user', newChat.task)
                this.enqueue(agentId, thread.id, newChat.task, 1)
                const notice = this.db.addMessage(
                  nextTask.threadId,
                  'system',
                  `💬 Novo chat iniciado: "${newChat.title}"`,
                )
                this.events?.onTurnFinished?.({
                  threadId: nextTask.threadId,
                  message: notice,
                  task: nextTask,
                })
              }
            }

            // 2. Marca a tarefa como concluída no banco
            const completedTask = this.db.updateTaskStatus(nextTask.id, 'completed')
            this.events?.onTaskStatusChanged?.({ task: completedTask })
            this.events?.onTurnFinished?.({
              threadId: nextTask.threadId,
              message: assistantMsg,
              task: completedTask,
            })
          } finally {
            if (!followUpScheduled) this.finishAgentTurn(agentId)
          }
        },
      },
    )

    this.registry.registerActiveExecution(nextTask.threadId, execution)
  }
}
