import type { Approval } from '../../shared/types'
import type { BrowserDirective } from '../browser/browser-protocol'
import type { ComputerDirective } from '../computer/computer-protocol'

/**
 * Pedido de aprovação humana. O bloco [[APROVAR]] para o turno.
 * No modo cauteloso, clique, preenchimento e desktop também geram um pedido
 * com payload: o runtime executa essas ações só depois do aprovado.
 *
 * [[APROVAR]]
 * Enviar o e-mail de cobrança para cliente@exemplo.com com o texto abaixo…
 * [[/APROVAR]]
 */

export type RuntimeApprovalPayload =
  | { kind: 'browser'; directives: BrowserDirective[] }
  | { kind: 'computer'; directives: ComputerDirective[] }

export function parseRuntimePayload(raw: string | undefined): RuntimeApprovalPayload | undefined {
  if (!raw) return undefined
  try {
    const value = JSON.parse(raw) as RuntimeApprovalPayload
    if (!value || (value.kind !== 'browser' && value.kind !== 'computer')) return undefined
    if (!Array.isArray(value.directives) || value.directives.length === 0) return undefined
    return value
  } catch {
    return undefined
  }
}

export function runtimeApprovalText(payload: RuntimeApprovalPayload): string {
  const lines =
    payload.kind === 'browser'
      ? payload.directives.map(describeBrowser)
      : payload.directives.map(describeComputer)
  const head =
    payload.kind === 'browser'
      ? 'Navegador, modo cauteloso. Estas ações só rodam depois do aprovado:'
      : 'Computador, modo cauteloso. Estas ações só rodam depois do aprovado:'
  return [head, ...lines.map((line) => `- ${line}`)].join('\n')
}

function describeBrowser(directive: BrowserDirective): string {
  switch (directive.action) {
    case 'click':
      return `Clicar em ${directive.target ?? ''}`
    case 'fill':
      return `Preencher ${directive.target ?? ''} com “${directive.value ?? ''}”`
    case 'close':
      return `Fechar a aba ${directive.target ?? ''}`.trim()
    case 'open':
      return `Abrir ${directive.target ?? ''}`
    case 'inspect':
      return 'Inspecionar a página'
    case 'screenshot':
      return 'Capturar a tela do navegador'
  }
}

function describeComputer(directive: ComputerDirective): string {
  switch (directive.action) {
    case 'open':
      return `Abrir o aplicativo: ${directive.target ?? ''}`
    case 'click':
      return `Clicar em ${directive.x}, ${directive.y}`
    case 'type':
      return `Digitar “${directive.target ?? ''}”`
    case 'key':
      return `Tecla ${directive.target ?? ''}`
    case 'apps':
      return 'Listar janelas'
    case 'screenshot':
      return 'Capturar a tela'
  }
}

/** Resposta quando o runtime já executou o payload. O modelo não repete a ação. */
export function runtimeApprovalDonePrompt(approval: Approval, resultSection: string): string {
  return [
    '[RESPOSTA DA APROVAÇÃO] APROVADO',
    `Pedido: ${approval.text}`,
    approval.note ? `Comentário do usuário: ${approval.note}` : '',
    'O Orchbot já executou estas ações. Não as repita.',
    resultSection,
    'Com base nisto, continue a tarefa e responda ao usuário.',
  ]
    .filter(Boolean)
    .join('\n')
}
const BLOCK_RE = /\[\[APROVAR\]\]([\s\S]*?)\[\[\/APROVAR\]\]/g
const QUESTION_RE = /\[\[PERGUNTAR\]\]([\s\S]*?)\[\[\/PERGUNTAR\]\]/g
const MAX_QUESTION_OPTIONS = 6

export interface QuestionRequest {
  text: string
  options: string[]
}

export function parseApprovalRequests(text: string): string[] {
  return [...text.matchAll(BLOCK_RE)].map((m) => (m[1] ?? '').trim()).filter(Boolean)
}

export function stripApprovalRequests(text: string): string {
  return text.replace(BLOCK_RE, '').trim()
}

export function parseQuestionRequests(text: string): QuestionRequest[] {
  const questions: QuestionRequest[] = []
  for (const match of text.matchAll(QUESTION_RE)) {
    const body = (match[1] ?? '').trim()
    if (!body) continue
    const options: string[] = []
    const questionLines: string[] = []
    for (const line of body.split(/\r?\n/)) {
      const trimmed = line.trim()
      if (!trimmed) continue
      const option = trimmed.match(/^[-*]\s+(.+)$/)
      if (option?.[1]) {
        if (options.length < MAX_QUESTION_OPTIONS) options.push(option[1].trim())
        continue
      }
      questionLines.push(trimmed)
    }
    const question = questionLines.join(' ').trim()
    if (!question) continue
    questions.push({ text: question, options })
  }
  return questions
}

export function stripQuestionRequests(text: string): string {
  return text.replace(QUESTION_RE, '').trim()
}

export const APPROVAL_INSTRUCTIONS = [
  '[APROVAÇÃO DO USUÁRIO]',
  'Antes de qualquer ação que mexa no mundo real e seja difícil de desfazer (enviar mensagem ou e-mail a terceiros, publicar, pagar ou comprar, apagar dados ou arquivos do usuário que a tarefa não pediu para apagar), PARE e peça aprovação:',
  '[[APROVAR]]',
  'o que você vai fazer, para quem/onde e o conteúdo exato',
  '[[/APROVAR]]',
  'Depois do bloco, encerre a resposta e NÃO execute a ação. Você receberá [RESPOSTA DA APROVAÇÃO] com APROVADO ou RECUSADO.',
  'Junte tudo que precisa de aprovação num único bloco por turno. Leituras, pesquisas e rascunhos não precisam de aprovação.',
  'Para perguntar algo que só a pessoa pode responder (escolha, confirmação, um dado), use:',
  '[[PERGUNTAR]]',
  'a pergunta',
  '- opção 1',
  '- opção 2',
  '[[/PERGUNTAR]]',
  'Sem opções, a pessoa responde em texto livre. Depois do bloco, encerre e espere [RESPOSTA DA PERGUNTA].',
].join('\n')

export function approvalAnswerPrompt(approval: Approval): string {
  if (approval.kind === 'question') {
    const answered = approval.status === 'approved'
    return [
      `[RESPOSTA DA PERGUNTA] ${answered ? 'RESPONDIDO' : 'PULADO'}`,
      `Pergunta: ${approval.text}`,
      answered
        ? `Resposta da pessoa: ${approval.note || '(sem texto)'}`
        : 'A pessoa pulou esta pergunta. Siga sem essa escolha ou pergunte de outro jeito.',
      answered ? 'Continue com essa escolha.' : '',
    ]
      .filter(Boolean)
      .join('\n')
  }
  const approved = approval.status === 'approved'
  return [
    `[RESPOSTA DA APROVAÇÃO] ${approved ? 'APROVADO' : 'RECUSADO'}`,
    `Pedido: ${approval.text}`,
    approval.note ? `Comentário do usuário: ${approval.note}` : '',
    approved
      ? 'Pode executar exatamente o que foi aprovado e depois conte o resultado.'
      : 'Não execute. Siga sem essa ação ou proponha outra alternativa.',
  ]
    .filter(Boolean)
    .join('\n')
}
