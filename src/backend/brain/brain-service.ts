import fs from 'node:fs'
import path from 'node:path'
import type {
  Agent,
  BrainPage,
  BrainPageType,
  BrainProposal,
  SaveBrainPageInput,
} from '../../shared/types'
import { slugify } from '../skills/skill-service'
import type { OrchbotDatabase } from '../storage/db'
import {
  BRAIN_MAX_CONTENT,
  BRAIN_SLUG_RE,
  type BrainDirective,
  type BrainPageDraft,
  needsBrainFollowUp,
  parseBrainDecision,
  parsePageDraft,
  unconfirmedHeadings,
} from './brain-protocol'

const CARD_LINES = 12
const MAX_INDEX_CHARS = 3500
const MAX_READ_CHARS = 8_000
const MAX_TITLE = 120
const MAX_REASON = 500
const MAX_SOURCE = 300

const NO_PROJECT = 'sem projeto: o cérebro é compartilhado pelo projeto, e você não está em um.'

export interface BrainRunResult {
  lines: string[]
  followUp: boolean
}

function asType(type: string, slug: string): BrainPageType {
  if (slug === 'company') return 'company'
  if (type === 'company' || type === 'product' || type === 'note') return type
  return 'note'
}

function clip(text: string, max: number): string {
  const clean = text.trim()
  return clean.length > max ? clean.slice(0, max) : clean
}

function excerpt(content: string): string {
  const text = content
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0)
    .slice(0, CARD_LINES)
    .join('\n')
  return text.length > 900 ? `${text.slice(0, 899)}…` : text
}

function pageLine(page: BrainPage): string {
  const pending = page.unconfirmed.length ? `, não confirmado: ${page.unconfirmed.join(', ')}` : ''
  return `- [[${page.slug}]] ${page.title} (${page.type}${pending})`
}

export class BrainService {
  constructor(private db: OrchbotDatabase) {}

  public listPages(projectId: string): BrainPage[] {
    this.requireProject(projectId)
    return this.db.listBrainPages(projectId).map((row) => this.toPage(row))
  }

  public listProposals(projectId: string): BrainProposal[] {
    this.requireProject(projectId)
    return this.db.listBrainProposals(projectId, 'open').map((row) => this.toProposal(row))
  }

  /** Gravação da pessoa, do líder, ou do aceite de uma proposta. Substitui a página inteira. */
  public savePage(input: SaveBrainPageInput): BrainPage {
    this.requireProject(input.projectId)
    const title = clip(input.title ?? '', MAX_TITLE)
    if (!title) throw new Error('A página precisa de um título.')
    const content = input.content?.trim() ?? ''
    if (!content) throw new Error('A página veio vazia.')
    if (content.length > BRAIN_MAX_CONTENT) {
      throw new Error(`A página passa de ${BRAIN_MAX_CONTENT} caracteres.`)
    }
    const slug = this.normalizeSlug(input.slug ?? '', title)
    const type = slug === 'company' ? 'company' : (input.type ?? 'note')
    if (type !== 'company' && type !== 'product' && type !== 'note') {
      throw new Error('Tipo de página inválido.')
    }
    const existing = this.db.getBrainPage(input.projectId, slug)
    if (existing && input.replace !== true) {
      throw new Error('Já existe uma página com esse nome. Abra ela para alterar.')
    }
    return this.toPage(
      this.db.upsertBrainPage({
        projectId: input.projectId,
        slug,
        title,
        type,
        content,
      }),
    )
  }

  public deletePage(projectId: string, slug: string): boolean {
    this.requireProject(projectId)
    return this.db.deleteBrainPage(projectId, slug)
  }

  public decide(id: string, accept: boolean): BrainProposal {
    const row = this.db.findBrainProposal(id)
    if (!row || row.status !== 'open') throw new Error('Proposta não encontrada ou já decidida.')
    if (accept) {
      this.savePage({
        projectId: row.projectId,
        slug: row.slug,
        title: row.title,
        type: asType(row.type, row.slug),
        content: row.content,
        replace: true,
      })
    }
    return this.toProposal(
      this.db.setBrainProposalStatus(row.id, accept ? 'accepted' : 'dismissed'),
    )
  }

  /** Regras + índice curto. Ausente quando o robô não está num projeto. */
  public contextSection(agent: Agent): string | null {
    if (!agent.projectId) return null
    const pages = this.db.listBrainPages(agent.projectId).map((row) => this.toPage(row))
    const waiting =
      agent.role === 'orchestrator' ? this.db.countOpenBrainProposals(agent.projectId) : 0
    return [
      rulesFor(agent.role === 'orchestrator'),
      ...indexOf(pages, agent.role === 'orchestrator'),
      waitingNote(waiting),
    ]
      .filter(Boolean)
      .join('\n\n')
  }

  public run(agent: Agent, directives: BrainDirective[]): BrainRunResult {
    if (directives.length === 0) return { lines: [], followUp: false }
    if (!agent.projectId) {
      return {
        lines: directives.map((d) => `[BRAIN:${d.action}] ${NO_PROJECT}`),
        followUp: false,
      }
    }
    const lines = directives.map((directive) => {
      try {
        return this.apply(agent, directive)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return `[BRAIN:${directive.action}] ${message}`
      }
    })
    return { lines, followUp: needsBrainFollowUp(directives) }
  }

  private apply(agent: Agent, directive: BrainDirective): string {
    const projectId = agent.projectId
    if (!projectId) return `[BRAIN:${directive.action}] ${NO_PROJECT}`
    const leader = agent.role === 'orchestrator'
    switch (directive.action) {
      case 'search':
        return this.search(projectId, directive.body)
      case 'read':
        return this.read(projectId, directive.body)
      case 'proposals':
        return this.proposalLines(projectId)
      case 'propose':
        return this.propose(agent, directive.body)
      case 'write':
        if (!leader) {
          return '[BRAIN:write] gravação recusada: só o líder ou a pessoa grava no cérebro. Proponha com [[BRAIN:propose]]. A página não mudou.'
        }
        return this.write(projectId, directive.body)
      case 'decide':
        if (!leader) {
          return '[BRAIN:decide] decisão recusada: só o líder ou a pessoa aceita ou dispensa. A página não mudou.'
        }
        return this.decideFromModel(projectId, directive.body)
      default:
        return `[BRAIN:${directive.action}] ação desconhecida.`
    }
  }

  private search(projectId: string, query: string): string {
    const pages = this.listPages(projectId)
    const q = query.trim().toLowerCase()
    const exact = pages.filter((page) => page.slug === q || page.title.toLowerCase() === q)
    const terms = q.split(/\s+/).filter((term) => term.length > 2)
    // shortcut: varre as páginas do projeto na memória; trocar por FTS5 se um projeto passar de algumas centenas de páginas.
    const hits =
      exact.length > 0
        ? exact
        : pages
            .map((page) => {
              const hay = `${page.slug}\n${page.title}\n${page.content}`.toLowerCase()
              return { page, score: terms.filter((term) => hay.includes(term)).length }
            })
            .filter((hit) => hit.score > 0)
            .sort((a, b) => b.score - a.score)
            .map((hit) => hit.page)
    if (hits.length === 0) {
      return `[BRAIN:search] nenhuma página.${terms.length === 0 ? ' Use um slug ou termos com mais de 2 letras.' : ''}`
    }
    const lines = hits
      .slice(0, 6)
      .map((page) => `- [[${page.slug}]] ${page.title}: ${snippet(page, terms)}`)
    return `[BRAIN:search] ${hits.length} página(s)\n${lines.join('\n')}`
  }

  private read(projectId: string, slug: string): string {
    const page = this.listPages(projectId).find((item) => item.slug === slug.trim().toLowerCase())
    if (!page) {
      const known = this.listPages(projectId)
        .map((item) => item.slug)
        .join(', ')
      return `[BRAIN:read] página não encontrada.${known ? ` Páginas: ${known}` : ''}`
    }
    const pending = page.unconfirmed.length
      ? `\nNão confirmado: ${page.unconfirmed.join(', ')}`
      : ''
    const body =
      page.content.length > MAX_READ_CHARS
        ? `${page.content.slice(0, MAX_READ_CHARS)}\n…(página cortada)`
        : page.content
    const files = this.attachmentLines(projectId, page.content)
    return `[BRAIN:read] [[${page.slug}]] ${page.title} (${page.type})${pending}\n${body}${files}`
  }

  private proposalLines(projectId: string): string {
    const open = this.listProposals(projectId)
    if (open.length === 0) return '[BRAIN:proposals] nenhuma proposta aberta.'
    const lines = open.slice(0, 15).map((proposal) => {
      const who = proposal.agentId
        ? (this.db.getAgent(proposal.agentId)?.name ?? 'colega')
        : 'colega'
      const source = proposal.source ? ` fonte: ${proposal.source}` : ''
      return `- ${proposal.id.slice(0, 8)} [[${proposal.slug}]] ${proposal.title} (${who}): ${proposal.reason}${source}`
    })
    return `[BRAIN:proposals] ${open.length} aberta(s)\n${lines.join('\n')}`
  }

  private propose(agent: Agent, body: string): string {
    const draft = this.draftFrom(body, true)
    const proposal = this.toProposal(
      this.db.insertBrainProposal({
        projectId: agent.projectId as string,
        agentId: agent.id,
        slug: draft.slug,
        title: draft.title,
        type: draft.type,
        content: draft.content,
        reason: draft.reason,
        source: draft.source,
      }),
    )
    return `[BRAIN:propose] proposta ${proposal.id.slice(0, 8)} aberta para [[${proposal.slug}]]. A página não mudou até alguém aceitar.`
  }

  private write(projectId: string, body: string): string {
    const draft = this.draftFrom(body, false)
    const page = this.savePage({
      projectId,
      slug: draft.slug,
      title: draft.title,
      type: draft.type,
      content: draft.content,
      replace: true,
    })
    return `[BRAIN:write] página [[${page.slug}]] gravada.`
  }

  private decideFromModel(projectId: string, body: string): string {
    const decision = parseBrainDecision(body)
    if ('error' in decision) return `[BRAIN:decide] ${decision.error}`
    const row = this.db.findBrainProposal(decision.id, projectId)
    if (!row || row.status !== 'open')
      return '[BRAIN:decide] proposta não encontrada ou já decidida.'
    const proposal = this.decide(row.id, decision.accept)
    return decision.accept
      ? `[BRAIN:decide] proposta ${proposal.id.slice(0, 8)} aceita. Página [[${proposal.slug}]] gravada.`
      : `[BRAIN:decide] proposta ${proposal.id.slice(0, 8)} dispensada. A página não mudou.`
  }

  private draftFrom(body: string, proposing: boolean): BrainPageDraft & { type: BrainPageType } {
    const parsed = parsePageDraft(body)
    if ('error' in parsed) throw new Error(parsed.error)
    if (parsed.content.length > BRAIN_MAX_CONTENT) {
      throw new Error(`A página passa de ${BRAIN_MAX_CONTENT} caracteres.`)
    }
    if (proposing && !parsed.reason.trim()) {
      throw new Error('falta o motivo (reason:). A página não mudou.')
    }
    const title = clip(parsed.title, MAX_TITLE)
    const slug = this.normalizeSlug(parsed.slug, title)
    return {
      ...parsed,
      slug,
      title: title || slug,
      type: slug === 'company' ? 'company' : (parsed.type ?? 'note'),
      reason: clip(parsed.reason, MAX_REASON),
      source: clip(parsed.source, MAX_SOURCE),
    }
  }

  private normalizeSlug(slug: string, title: string): string {
    const raw = (slug || slugify(title)).toLowerCase()
    if (!BRAIN_SLUG_RE.test(raw)) throw new Error(`slug inválido: ${raw || '(vazio)'}`)
    return raw
  }

  /** Arquivos citados como `shared/<nome>` na página, resolvidos na pasta compartilhada do projeto. */
  private attachmentLines(projectId: string, content: string): string {
    const root = this.db.getProject(projectId)?.workspacePath
    if (!root) return ''
    const shared = path.join(path.resolve(root), 'shared')
    const names = new Set(
      [...content.matchAll(/(?:^|[\s(`'"])shared\/([^\s)`'"<>\]]+)/g)].map((m) => m[1]),
    )
    const lines = [...names].map((name) => {
      const file = path.resolve(shared, name)
      if (!file.startsWith(shared + path.sep))
        return `- shared/${name}: fora da pasta compartilhada.`
      const stat = fs.statSync(file, { throwIfNoEntry: false })
      if (!stat?.isFile()) return `- shared/${name}: não encontrado.`
      return `- shared/${name} → ${file} (${Math.max(1, Math.round(stat.size / 1024))} KB)`
    })
    return lines.length ? `\nAnexos:\n${lines.join('\n')}` : ''
  }

  private requireProject(projectId: string): void {
    if (!projectId || !this.db.getProject(projectId)) throw new Error('Projeto não encontrado.')
  }

  private toPage(row: {
    id: string
    projectId: string
    slug: string
    title: string
    type: string
    content: string
    updatedAt: string
  }): BrainPage {
    return {
      ...row,
      type: asType(row.type, row.slug),
      unconfirmed: unconfirmedHeadings(row.content),
    }
  }

  private toProposal(row: {
    id: string
    projectId: string
    agentId: string | null
    slug: string
    title: string
    type: string
    content: string
    reason: string
    source: string
    status: string
    createdAt: string
    decidedAt: string | null
  }): BrainProposal {
    const status = row.status === 'accepted' || row.status === 'dismissed' ? row.status : 'open'
    return {
      id: row.id,
      projectId: row.projectId,
      agentId: row.agentId ?? undefined,
      slug: row.slug,
      title: row.title,
      type: asType(row.type, row.slug),
      content: row.content,
      reason: row.reason,
      source: row.source,
      unconfirmed: unconfirmedHeadings(row.content),
      status,
      createdAt: row.createdAt,
      decidedAt: row.decidedAt ?? undefined,
    }
  }
}

function rulesFor(leader: boolean): string {
  const shared = [
    '[CÉREBRO DO PROJETO]',
    'Wiki comum deste projeto, separado da sua memória. Guarda o que é da empresa ou do projeto: o que vende, para quem, a que preço, tom, ferramentas, clientes e concorrentes.',
    'O que uma pessoa escreveu ou confirmou vale mais que a sua memória. Um título com <!-- não confirmado --> veio da web e ninguém confirmou: ponto de partida, não fato. Se a entrega depender de um trecho não confirmado, entregue mesmo assim e abra a resposta com uma linha dizendo a suposição e de onde veio.',
    'Antes de responder algo que dependa do projeto, [[BRAIN:search]] e depois [[BRAIN:read]] o slug. Antes de escrever sobre um produto, [[BRAIN:read]] a página desse produto. Ligue páginas com [[slug]].',
    'Fato da empresa nunca vai em [[MEMORY:remember]]. Memória é só do seu próprio trabalho.',
    'Para anexar um arquivo a uma página, salve-o na pasta compartilhada do projeto e cite shared/<nome> no texto. O [[BRAIN:read]] devolve o caminho de cada anexo.',
  ]
  if (!leader) {
    return [
      ...shared,
      'Você não grava. Quando a pessoa contar ou corrigir um fato, ou quando você achar um na web ou num arquivo, proponha a página inteira. Ela não muda até alguém aceitar, então não diga que gravou:',
      '[[BRAIN:propose]]',
      'slug: tom-de-voz',
      'title: Tom de voz',
      'reason: a pessoa descreveu assim',
      'source: conversa',
      '---',
      '# Tom de voz',
      '## Voz <!-- não confirmado -->',
      'texto da página inteira',
      '[[/BRAIN]]',
      '[[BRAIN:search]] termos [[/BRAIN]]',
      '[[BRAIN:read]] slug [[/BRAIN]]',
    ].join('\n')
  }
  return [
    ...shared,
    'Você grava quando a pessoa conta, pede para mudar ou confirma. Fato que você achou sozinho: pergunte antes, não grave. A página company é o cartão da empresa.',
    '[[BRAIN:write]]',
    'slug: company',
    'title: Empresa',
    'type: company',
    '---',
    '# Empresa',
    'texto da página inteira',
    '[[/BRAIN]]',
    'Colegas propõem em vez de gravar. [[BRAIN:proposals]] lista as abertas. Depois que a pessoa decidir: [[BRAIN:decide]] id aceitar [[/BRAIN]] ou [[BRAIN:decide]] id dispensar [[/BRAIN]]. Mencione as propostas abertas quando tiverem a ver com o que ela está fazendo. Apagar página é só pela tela.',
    '[[BRAIN:search]] termos [[/BRAIN]]',
    '[[BRAIN:read]] slug [[/BRAIN]]',
  ].join('\n')
}

function waitingNote(waiting: number): string {
  if (waiting <= 0) return ''
  return `Propostas dos colegas esperando revisão: ${waiting} ([[BRAIN:proposals]]).`
}

function indexOf(pages: BrainPage[], leader: boolean): string[] {
  if (pages.length === 0) {
    return [
      leader
        ? 'O cérebro ainda está vazio. Pergunte à pessoa o essencial e grave a página company.'
        : 'O cérebro ainda está vazio. Antes de perguntar à pessoa o que a empresa faz ou vende, pergunte aos colegas do projeto que já possam saber.',
    ]
  }
  const company =
    pages.find((page) => page.slug === 'company') ?? pages.find((page) => page.type === 'company')
  const products = pages.filter((page) => page.type === 'product' && page !== company)
  const others = pages.filter((page) => page !== company && page.type !== 'product')
  const parts: string[] = []
  if (company) {
    const pending = company.unconfirmed.length
      ? `\nNão confirmado: ${company.unconfirmed.join(', ')}`
      : ''
    parts.push(
      `Cartão da empresa ([[${company.slug}]], [[BRAIN:read]] para o resto):\n${excerpt(company.content)}${pending}`,
    )
  }
  const lines: string[] = []
  let chars = 0
  for (const page of others.slice(0, 40)) {
    const line = pageLine(page)
    if (chars + line.length > MAX_INDEX_CHARS) break
    lines.push(line)
    chars += line.length + 1
  }
  const more = others.length - lines.length
  if (products.length > 0) lines.push(productLine(products))
  if (lines.length > 0) {
    parts.push(
      `Páginas:\n${lines.join('\n')}${more > 0 ? `\n… e mais ${more}, ache com [[BRAIN:search]].` : ''}`,
    )
  }
  return parts
}

function productLine(products: BrainPage[]): string {
  const links: string[] = []
  let chars = 0
  for (const product of products) {
    const link = `[[${product.slug}]] ${product.title}`
    if (chars + link.length > 500) break
    links.push(link)
    chars += link.length + 2
  }
  const more = products.length - links.length
  return `- Produtos (${products.length}): ${links.join(', ')}${more > 0 ? `, e mais ${more}` : ''}`
}

function snippet(page: BrainPage, terms: string[]): string {
  const lines = page.content.split('\n')
  const hit =
    lines.find((line) => terms.some((term) => line.toLowerCase().includes(term))) ?? lines[0] ?? ''
  const one = hit.replace(/\s+/g, ' ').trim()
  return one.length > 180 ? `${one.slice(0, 179)}…` : one
}
