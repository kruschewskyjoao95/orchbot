export type MemoryAction = 'remember' | 'forget' | 'search'
export type HistoryAction = 'search' | 'read'

export interface MemoryDirective {
  kind: 'MEMORY' | 'HISTORY'
  action: MemoryAction | HistoryAction
  body: string
}

const BLOCK_RE = /\[\[(MEMORY|HISTORY):([a-z]+)\]\]([\s\S]*?)\[\[\/(?:MEMORY|HISTORY)\]\]/gi
const VALID: Record<string, string[]> = {
  MEMORY: ['remember', 'forget', 'search'],
  HISTORY: ['search', 'read'],
}

export function parseMemoryDirectives(text: string): MemoryDirective[] {
  const out: MemoryDirective[] = []
  for (const m of text.matchAll(BLOCK_RE)) {
    const kind = m[1].toUpperCase() as 'MEMORY' | 'HISTORY'
    const action = m[2].toLowerCase()
    const body = m[3].trim()
    if (VALID[kind].includes(action) && body)
      out.push({ kind, action: action as MemoryAction | HistoryAction, body })
  }
  return out
}

export function stripMemoryDirectives(text: string): string {
  return text.replace(BLOCK_RE, '').trim()
}

/** Diretivas que precisam devolver resultado ao modelo (exigem um novo turno). */
export function needsMemoryFollowUp(directives: MemoryDirective[]): boolean {
  return directives.some((d) => d.action === 'search' || d.action === 'read')
}

export function buildMemoryInstructions(): string {
  return [
    '[MEMÓRIA E HISTÓRICO LOCAIS]',
    'Você tem memória persistente só neste computador, e ela é sua: preferência do seu trabalho, decisão de uma tarefa, detalhe que nenhuma página do cérebro cobre.',
    'O que é da empresa ou do projeto (o que vende, para quem, a que preço, tom de voz, ferramentas, clientes, concorrentes) NÃO entra em [[MEMORY:remember]]. Isso vai para o cérebro do projeto.',
    'Procedimento, checklist e formato de saída também não entram na memória. Use [[SKILL:create]]: vira proposta e só vale quando a pessoa aceitar.',
    'Use blocos ao final da resposta:',
    '[[MEMORY:remember]] fato do seu próprio trabalho [[/MEMORY]]',
    '[[MEMORY:forget]] id-da-memória [[/MEMORY]]',
    '[[MEMORY:search]] termos [[/MEMORY]]',
    '[[HISTORY:search]] termos [[/HISTORY]]  (busca em conversas antigas, inclusive trechos cortados do contexto)',
    '[[HISTORY:read]] id-da-mensagem [[/HISTORY]]  (lê a mensagem e as vizinhas)',
    'Memorize só o que vale para o futuro; nunca guarde senhas, chaves ou dados sensíveis. Resultados de search/read chegam em [RESULTADO DA MEMÓRIA].',
  ].join('\n')
}
