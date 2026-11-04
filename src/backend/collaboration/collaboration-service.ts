import fs from 'node:fs'
import path from 'node:path'
import type { Agent, Channel, ChannelMessage, CreateChannelInput } from '../../shared/types'
import { MAX_ORCHESTRATION_DEPTH } from '../orchestration/protocol'
import { describeMiss, resolveAgent } from '../orchestration/resolve-agent'
import { orchbotDir } from '../storage/agent-mirror'

/** Cada ida e volta no canal consome um nível; limita loops sem travar tarefas de várias etapas. */
export const MAX_CHANNEL_DEPTH = 8
import type { OrchbotDatabase } from '../storage/db'
import { type CollabDirective, buildCollabInstructions } from './collab-protocol'

const MAX_FILE_BYTES = 25 * 1024 * 1024
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)
const short = (id: string) => id.slice(0, 8)

export interface CollabHooks {
  enqueue: (
    agentId: string,
    threadId: string,
    prompt: string,
    depth: number,
    origin?: { originThreadId?: string; originAgentId?: string },
  ) => unknown
  cancelTask: (taskId: string) => boolean
  /** Avisa a interface que algo mudou numa conversa/canal. */
  changed?: () => void
}

export class CollaborationService {
  constructor(
    private db: OrchbotDatabase,
    private hooks: CollabHooks,
  ) {}

  /** Agentes com quem `agent` pode falar: mesmo projeto (ou todos se ele não tem projeto). */
  public peers(agent: Agent): Agent[] {
    return this.db
      .listAgents()
      .filter((a) => a.id !== agent.id && (!agent.projectId || a.projectId === agent.projectId))
  }

  private resolvePeer(agent: Agent, name: string): { agent: Agent } | { error: string } {
    const m = resolveAgent(name, this.peers(agent))
    return m.match ? { agent: m.match } : { error: describeMiss(name, m) }
  }

  /** Conversa mais ativa do agente (última mensagem), fora de canais. */
  public latestThread(agentId: string): string | undefined {
    return this.db.getActiveThread(agentId)?.id
  }

  /** Seções de contexto: protocolo de DM e, se a conversa for de um canal, o briefing dele. */
  public contextSections(agent: Agent, threadId: string): string[] {
    const sections = [buildCollabInstructions()]
    const hit = this.db.getChannelByThread(threadId)
    if (!hit) return sections
    const { channel } = hit
    const isOwner = channel.ownerAgentId === agent.id
    const names = channel.members
      .map((m) => this.db.getAgent(m.agentId))
      .filter((a): a is Agent => Boolean(a))
    const log = this.db
      .listChannelMessages(channel.id, 12)
      .map((m) => `- ${this.authorName(m)}: ${clip(m.text.replace(/\s+/g, ' '), 300)}`)
      .join('\n')
    sections.push(
      [
        `[CANAL "${channel.title}"]`,
        channel.goal ? `Objetivo: ${channel.goal}` : '',
        `Participantes: ${names.map((a) => a.name + (a.id === channel.ownerAgentId ? ' (dono)' : '')).join(', ')}`,
        isOwner
          ? 'Você é o DONO da tarefa: coordene, peça trabalho aos outros com [[CHANNEL:ask]] Nome :: tarefa [[/CHANNEL]] e entregue o resultado final ao usuário. Você responde pelo andamento.'
          : 'Você é participante: responda apenas ao que lhe foi pedido, de forma objetiva. O dono consolida o resultado.',
        'Sua resposta é publicada automaticamente no canal.',
        log ? `Últimas mensagens:\n${log}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
    )
    return sections
  }

  private authorName(m: ChannelMessage): string {
    if (m.kind === 'system') return 'Sistema'
    return m.authorAgentId ? (this.db.getAgent(m.authorAgentId)?.name ?? 'Agente') : 'Usuário'
  }

  /** Executa os blocos do turno. `lines` volta para o modelo; `followUp` pede novo turno. */
  public run(
    agent: Agent,
    ctx: { threadId: string; depth: number },
    directives: CollabDirective[],
  ): { lines: string[]; followUp: boolean } {
    const lines: string[] = []
    let followUp = false
    for (const d of directives) {
      const label = `${d.kind.toLowerCase()}:${d.action}`
      try {
        if (d.kind === 'CHANNEL') lines.push(`[${label}] ${this.channelAsk(agent, ctx, d)}`)
        else if (d.action === 'list') {
          followUp = true
          const peers = this.peers(agent)
          lines.push(
            `[${label}] ${peers.length ? peers.map((a) => `- ${a.name}${a.description ? `: ${a.description}` : ''}`).join('\n') : 'nenhum outro agente disponível.'}`,
          )
        } else if (d.action === 'send')
          lines.push(`[${label}] ${this.send(agent, ctx, d.target, d.body)}`)
        else if (d.action === 'reply')
          lines.push(`[${label}] ${this.reply(agent, ctx, d.target, d.body)}`)
        else if (d.action === 'react')
          lines.push(`[${label}] ${this.react(agent, d.target, d.body)}`)
        else lines.push(`[${label}] ${this.sendFile(agent, ctx, d.target, d.body)}`)
      } catch (err) {
        lines.push(`[${label}] erro: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
    return { lines, followUp }
  }

  /** Entrega `text` na conversa de `to`, registra o vínculo e dispara um turno dele. */
  private deliver(
    from: Agent,
    fromThreadId: string,
    to: Agent,
    toThreadId: string,
    text: string,
    depth: number,
  ): string {
    if (depth >= MAX_ORCHESTRATION_DEPTH)
      throw new Error('limite de encadeamento entre agentes atingido.')
    const message = this.db.addMessage(toThreadId, 'user', text, from.id, to.id)
    this.db.recordDirectMessage(message.id, from.id, fromThreadId, to.id, toThreadId)
    this.hooks.enqueue(
      to.id,
      toThreadId,
      `[Mensagem direta de ${from.name} · id ${short(message.id)}]\n${text}`,
      depth + 1,
    )
    this.hooks.changed?.()
    return short(message.id)
  }

  private send(
    from: Agent,
    ctx: { threadId: string; depth: number },
    target: string,
    text: string,
  ): string {
    const peer = this.resolvePeer(from, target)
    if ('error' in peer) return peer.error
    const to = peer.agent
    const toThread = this.latestThread(to.id)
    if (!toThread) return `${to.name} não tem conversa disponível.`
    const id = this.deliver(from, ctx.threadId, to, toThread, text, ctx.depth)
    return `enviado a ${to.name} (id ${id}).`
  }

  private reply(
    from: Agent,
    ctx: { threadId: string; depth: number },
    messageId: string,
    text: string,
  ): string {
    const dm = this.db.findDirectMessage(from.id, messageId)
    if (!dm) return 'mensagem não encontrada (só dá para responder mensagens que você recebeu).'
    const to = this.db.getAgent(dm.fromAgentId)
    if (!to) return 'o remetente não existe mais.'
    const id = this.deliver(from, ctx.threadId, to, dm.fromThreadId, text, ctx.depth)
    return `resposta enviada a ${to.name} (id ${id}).`
  }

  private react(from: Agent, messageId: string, emoji: string): string {
    const dm = this.db.findDirectMessage(from.id, messageId)
    if (!dm) return 'mensagem não encontrada.'
    const e = [...emoji.trim()].slice(0, 4).join('')
    if (!e) return 'emoji vazio.'
    this.db.addReaction(dm.messageId, from.id, e)
    // Reação é só um aviso para o remetente; não gasta turno de modelo.
    this.db.addMessage(
      dm.fromThreadId,
      'system',
      `${e} ${from.name} reagiu a: “${clip(dm.text.replace(/\s+/g, ' '), 80)}”`,
    )
    this.hooks.changed?.()
    return `reação ${e} registrada.`
  }

  /** Copia um arquivo do workspace do remetente para `.orchbot/inbox/<remetente>/` do destinatário. */
  private sendFile(
    from: Agent,
    ctx: { threadId: string; depth: number },
    target: string,
    rel: string,
  ): string {
    const peer = this.resolvePeer(from, target)
    if ('error' in peer) return peer.error
    const to = peer.agent
    const root = path.resolve(from.workspacePath)
    const source = path.resolve(root, rel)
    if (source !== root && !source.startsWith(root + path.sep))
      return 'o arquivo precisa estar dentro do seu workspace.'
    const real = fs.existsSync(source) ? fs.realpathSync(source) : source
    if (!real.startsWith(fs.realpathSync(root) + path.sep))
      return 'o arquivo precisa estar dentro do seu workspace.'
    const stat = fs.statSync(real, { throwIfNoEntry: false })
    if (!stat?.isFile()) return 'arquivo não encontrado.'
    if (stat.size > MAX_FILE_BYTES) return 'arquivo maior que 25 MB.'
    const safeSender = from.name.replace(/[^\p{L}\p{N}_-]+/gu, '_').slice(0, 40) || 'agente'
    const dir = orchbotDir(to.workspacePath, 'inbox', safeSender)
    // Nunca sobrescreve: se já existe, grava como "nome (2).ext", "nome (3).ext"…
    const { name, ext } = path.parse(path.basename(real))
    let dest = path.join(dir, `${name}${ext}`)
    for (let n = 2; ; n++) {
      try {
        fs.copyFileSync(real, dest, fs.constants.COPYFILE_EXCL)
        break
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'EEXIST' || n > 999) throw err
        dest = path.join(dir, `${name} (${n})${ext}`)
      }
    }
    const toThread = this.latestThread(to.id)
    if (!toThread)
      return `arquivo copiado para ${dest}, mas ${to.name} não tem conversa para avisar.`
    const relDest = path.relative(path.resolve(to.workspacePath), dest)
    this.deliver(
      from,
      ctx.threadId,
      to,
      toThread,
      `📎 Enviei o arquivo "${path.basename(dest)}". Ele está em ${relDest} no seu workspace.`,
      ctx.depth,
    )
    return `arquivo entregue a ${to.name} em ${relDest}.`
  }

  // --- Canais ---

  private channelAsk(
    agent: Agent,
    ctx: { threadId: string; depth: number },
    d: CollabDirective,
  ): string {
    const hit = this.db.getChannelByThread(ctx.threadId)
    if (!hit) return 'você não está em um canal.'
    const { channel } = hit
    if (channel.status !== 'active' || channel.archived) return 'o canal está parado.'
    if (ctx.depth >= MAX_CHANNEL_DEPTH) return 'limite de encadeamento atingido.'
    const members = channel.members
      .map((m) => ({ m, a: this.db.getAgent(m.agentId) }))
      .filter(
        (x): x is { m: (typeof channel.members)[number]; a: Agent } => !!x.a && x.a.id !== agent.id,
      )
    const found = resolveAgent(
      d.target,
      members.map((x) => x.a),
    )
    if (!found.match) return `"${d.target}" não participa deste canal (nome exato, sem abreviar).`
    const member = members.find((x) => x.a.id === found.match?.id)
    if (!member) return `"${d.target}" não participa deste canal.`
    this.db.addChannelMessage(channel.id, agent.id, `@${member.a.name} ${d.body}`)
    const prompt = `[Tarefa no canal "${channel.title}" pedida por ${agent.name}]:\n${d.body}`
    this.db.addMessage(member.m.threadId, 'user', prompt, agent.id, member.a.id)
    this.hooks.enqueue(member.a.id, member.m.threadId, prompt, ctx.depth + 1, {
      originThreadId: ctx.threadId,
      originAgentId: agent.id,
    })
    return `pedido enviado a ${member.a.name}.`
  }

  public createChannel(input: CreateChannelInput): Channel {
    const channel = this.db.createChannel(input)
    this.hooks.changed?.()
    return channel
  }

  /** Mensagem do usuário: vai ao log e ao dono da tarefa. */
  public post(channelId: string, text: string): Channel {
    const channel = this.mustGet(channelId)
    if (channel.archived) throw new Error('Canal arquivado: restaure para continuar.')
    if (channel.status === 'stopped') throw new Error('Canal parado: retome para continuar.')
    const body = text.trim()
    if (!body) throw new Error('Mensagem vazia.')
    this.db.addChannelMessage(channel.id, null, body)
    const owner = channel.members.find((m) => m.agentId === channel.ownerAgentId)
    if (!owner) throw new Error('O canal está sem dono: reatribua a tarefa.')
    this.db.addMessage(owner.threadId, 'user', body)
    this.hooks.enqueue(owner.agentId, owner.threadId, body, 1)
    this.hooks.changed?.()
    return this.mustGet(channelId)
  }

  public stop(channelId: string): Channel {
    const channel = this.mustGet(channelId)
    this.db.updateChannel(channelId, { status: 'stopped' })
    for (const m of channel.members)
      for (const task of this.db.listOpenTasksForThread(m.threadId)) this.hooks.cancelTask(task.id)
    this.db.addChannelMessage(
      channelId,
      null,
      '⏹️ Canal parado: tarefas em andamento foram canceladas.',
      'system',
    )
    this.hooks.changed?.()
    return this.mustGet(channelId)
  }

  public resume(channelId: string): Channel {
    const channel = this.mustGet(channelId)
    if (channel.archived) throw new Error('Restaure o canal antes de retomar.')
    this.db.updateChannel(channelId, { status: 'active' })
    this.db.addChannelMessage(channelId, null, '▶️ Canal retomado.', 'system')
    this.hooks.changed?.()
    return this.mustGet(channelId)
  }

  public reassign(channelId: string, agentId: string): Channel {
    this.mustGet(channelId)
    const agent = this.db.getAgent(agentId)
    if (!agent) throw new Error('Agente não encontrado.')
    this.db.ensureChannelMember(channelId, agentId)
    this.db.updateChannel(channelId, { ownerAgentId: agentId })
    this.db.addChannelMessage(
      channelId,
      null,
      `🔁 Tarefa reatribuída para ${agent.name}.`,
      'system',
    )
    this.hooks.changed?.()
    return this.mustGet(channelId)
  }

  /** Arquivar também para tudo; restaurar volta parado, e quem retoma é o usuário. */
  public archive(channelId: string): Channel {
    this.stop(channelId)
    this.db.updateChannel(channelId, { archived: true })
    return this.mustGet(channelId)
  }

  public restore(channelId: string): Channel {
    this.mustGet(channelId)
    this.db.updateChannel(channelId, { archived: false })
    this.db.addChannelMessage(
      channelId,
      null,
      '♻️ Canal restaurado (parado: retome quando quiser).',
      'system',
    )
    this.hooks.changed?.()
    return this.mustGet(channelId)
  }

  private mustGet(id: string): Channel {
    const channel = this.db.getChannel(id)
    if (!channel) throw new Error('Canal não encontrado.')
    return channel
  }
}
