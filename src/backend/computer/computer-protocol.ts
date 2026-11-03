export type ComputerDirectiveAction = 'screenshot' | 'apps' | 'open' | 'click' | 'type' | 'key'

export interface ComputerDirective {
  action: ComputerDirectiveAction
  target?: string
  x?: number
  y?: number
}

export const MAX_COMPUTER_ROUNDS = 2

const BLOCK_RE = /\[\[COMPUTER:([a-z]+)\]\]([\s\S]*?)\[\[\/COMPUTER\]\]/gi
const KNOWN: ComputerDirectiveAction[] = ['screenshot', 'apps', 'open', 'click', 'type', 'key']

export function parseComputerDirectives(text: string): ComputerDirective[] {
  const directives: ComputerDirective[] = []
  for (const match of text.matchAll(BLOCK_RE)) {
    const action = match[1]?.toLowerCase() as ComputerDirectiveAction
    if (!KNOWN.includes(action)) continue
    const body = (match[2] ?? '').trim()
    if (action === 'click') {
      const coords = body
        .split(/[,\s]+/)
        .map(Number)
        .filter(Number.isFinite)
      if (coords.length >= 2) directives.push({ action, x: coords[0], y: coords[1] })
    } else if (action === 'screenshot' || action === 'apps') {
      directives.push({ action })
    } else if (body) {
      directives.push({ action, target: body })
    }
  }
  return directives
}

export function stripComputerDirectives(text: string): string {
  return text.replace(BLOCK_RE, '').trim()
}

export function argsForComputer(d: ComputerDirective): Record<string, unknown> {
  switch (d.action) {
    case 'open':
      return { app: d.target }
    case 'click':
      return { x: d.x, y: d.y }
    case 'type':
      return { text: d.target }
    case 'key':
      return { key: d.target }
    default:
      return {}
  }
}

export function buildComputerInstructions(agentName: string): string {
  return [
    '[USO DO COMPUTADOR]',
    `${agentName} pode ver e usar os apps deste computador (o usuário habilitou em Configurações).`,
    'Comandos ao final da resposta:',
    '[[COMPUTER:apps]] [[/COMPUTER]] — lista janelas abertas e coordenadas',
    '[[COMPUTER:screenshot]] [[/COMPUTER]] — captura a tela (arquivo salvo)',
    '[[COMPUTER:open]] nome-do-app [[/COMPUTER]]',
    '[[COMPUTER:click]] x,y [[/COMPUTER]]',
    '[[COMPUTER:type]] texto para digitar [[/COMPUTER]]',
    '[[COMPUTER:key]] Return [[/COMPUTER]]',
    'Fluxo: apps para localizar, screenshot para confirmar, click/type/key para agir, screenshot de novo para validar.',
    'Você recebe o retorno em [RESULTADO DO COMPUTADOR] e só então conclui para o usuário.',
  ].join('\n')
}
