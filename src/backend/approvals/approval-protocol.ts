import type { Approval } from '../../shared/types'

/**
 * Pedido de aprovação humana. O robô para o turno e espera a resposta:
 *
 * [[APROVAR]]
 * Enviar o e-mail de cobrança para cliente@exemplo.com com o texto abaixo…
 * [[/APROVAR]]
 */
const BLOCK_RE = /\[\[APROVAR\]\]([\s\S]*?)\[\[\/APROVAR\]\]/g

export function parseApprovalRequests(text: string): string[] {
  return [...text.matchAll(BLOCK_RE)].map((m) => (m[1] ?? '').trim()).filter(Boolean)
}

export function stripApprovalRequests(text: string): string {
  return text.replace(BLOCK_RE, '').trim()
}

export const APPROVAL_INSTRUCTIONS = [
  '[APROVAÇÃO DO USUÁRIO]',
  'Antes de qualquer ação que mexa no mundo real e seja difícil de desfazer (enviar mensagem ou e-mail a terceiros, publicar, pagar ou comprar, apagar dados ou arquivos do usuário que a tarefa não pediu para apagar), PARE e peça aprovação:',
  '[[APROVAR]]',
  'o que você vai fazer, para quem/onde e o conteúdo exato',
  '[[/APROVAR]]',
  'Depois do bloco, encerre a resposta e NÃO execute a ação. Você receberá [RESPOSTA DA APROVAÇÃO] com APROVADO ou RECUSADO.',
  'Junte tudo que precisa de aprovação num único bloco por turno. Leituras, pesquisas e rascunhos não precisam de aprovação.',
].join('\n')

export function approvalAnswerPrompt(approval: Approval): string {
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
