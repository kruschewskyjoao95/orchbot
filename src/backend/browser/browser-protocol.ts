export type BrowserDirectiveAction = 'open' | 'inspect' | 'click' | 'fill' | 'screenshot' | 'close'

export interface BrowserDirective {
  action: BrowserDirectiveAction
  /** url (open), seletor CSS (click/fill) ou tabId (close). */
  target?: string
  /** Valor do preenchimento (fill: `seletor :: valor`). */
  value?: string
}

export const MAX_BROWSER_ROUNDS = 2

const BLOCK_RE = /\[\[BROWSER:([a-z]+)\]\]([\s\S]*?)\[\[\/BROWSER\]\]/gi
const KNOWN: BrowserDirectiveAction[] = ['open', 'inspect', 'click', 'fill', 'screenshot', 'close']

/** Remove URLs/HTML perigosos e limita o texto que volta ao modelo (economia de tokens). */
export function summarizeBrowserResult(action: BrowserDirectiveAction, result: unknown): string {
  const MAX = 1500
  const clip = (s: string) => (s.length > MAX ? `${s.slice(0, MAX - 1)}…` : s)

  if (result && typeof result === 'object') {
    const obj = result as Record<string, unknown>
    if (action === 'inspect') {
      const links = Array.isArray(obj.links)
        ? (obj.links as Array<{ text?: string; href?: string }>)
            .slice(0, 12)
            .map((l) => `${l.text || l.href} -> ${l.href}`)
            .join('; ')
        : ''
      const inputs = Array.isArray(obj.inputs)
        ? (obj.inputs as Array<{ selector?: string; placeholder?: string }>)
            .slice(0, 12)
            .map((i) => i.selector)
            .join(', ')
        : ''
      return clip(
        [
          `Página: ${String(obj.title ?? '')} (${String(obj.url ?? '')})`,
          `Texto: ${String(obj.textSummary ?? '')}`,
          links ? `Links: ${links}` : '',
          inputs ? `Campos (seletores): ${inputs}` : '',
        ]
          .filter(Boolean)
          .join('\n'),
      )
    }
    if (action === 'screenshot') return 'Screenshot capturado (evidência visual salva, sem texto).'
    if (typeof obj.success === 'boolean') return `Ação ${action}: ${obj.success ? 'ok' : 'falhou'}.`
    if (typeof obj.url === 'string') return `Aba aberta: ${String(obj.title ?? '')} (${obj.url}).`
  }
  return clip(typeof result === 'string' ? result : JSON.stringify(result ?? ''))
}

/**
 * Protocolo de navegador do robô. Blocos ao final da resposta:
 * [[BROWSER:open]] https://... [[/BROWSER]]
 * [[BROWSER:inspect]] [[/BROWSER]]
 * [[BROWSER:click]] #seletor [[/BROWSER]]
 * [[BROWSER:fill]] #campo :: valor [[/BROWSER]]
 */
export function parseBrowserDirectives(text: string): BrowserDirective[] {
  const directives: BrowserDirective[] = []
  for (const match of text.matchAll(BLOCK_RE)) {
    const action = match[1]?.toLowerCase() as BrowserDirectiveAction
    if (!KNOWN.includes(action)) continue
    const body = (match[2] ?? '').trim()
    if (action === 'fill') {
      const sep = body.indexOf('::')
      if (sep < 0) continue
      directives.push({
        action,
        target: body.slice(0, sep).trim(),
        value: body.slice(sep + 2).trim(),
      })
    } else if (action === 'inspect' || action === 'screenshot') {
      directives.push({ action, target: body || undefined })
    } else if (body) {
      directives.push({ action, target: body })
    }
  }
  return directives
}

export function stripBrowserDirectives(text: string): string {
  return text.replace(BLOCK_RE, '').trim()
}

export function toolNameFor(action: BrowserDirectiveAction): string {
  return `orchbot_browser.${action}`
}

export function argsFor(directive: BrowserDirective): Record<string, unknown> {
  switch (directive.action) {
    case 'open':
      return { url: directive.target }
    case 'click':
      return { selector: directive.target }
    case 'fill':
      return { selector: directive.target, value: directive.value }
    case 'close':
      return { tabId: directive.target }
    default:
      return directive.target ? { tabId: directive.target } : {}
  }
}

export function buildBrowserInstructions(agentName: string): string {
  return [
    '[NAVEGADOR EMBUTIDO]',
    `${agentName} tem um navegador próprio com sessões/login persistentes (ex.: Meta Ads, Google Ads).`,
    'Para usar, emita blocos ao final da resposta:',
    '[[BROWSER:open]] https://url [[/BROWSER]]',
    '[[BROWSER:inspect]] [[/BROWSER]]',
    '[[BROWSER:click]] #seletor-css [[/BROWSER]]',
    '[[BROWSER:fill]] #campo :: valor [[/BROWSER]]',
    '[[BROWSER:screenshot]] [[/BROWSER]]',
    'Fluxo típico para métricas: open na URL do painel, inspect para ler números/links/campos, click/fill se precisar navegar, e só então analise.',
    'Você recebe o resultado do navegador na próxima mensagem [RESULTADO DO NAVEGADOR] e aí sim responde ao usuário.',
    'Nunca invente números de métricas: só afirme o que o inspect retornou.',
  ].join('\n')
}
