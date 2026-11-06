export type PageWindowMode = 'none' | 'visible' | 'hidden'

/** O que o botão do cabeçalho faz com a página aberta. */
export type PageWindowAction = 'background' | 'show-panel' | 'show-window' | 'dock'

export function pageWindowAction(input: {
  hasTab: boolean
  panelOpen: boolean
  window: PageWindowMode
}): PageWindowAction | null {
  if (!input.hasTab) return null
  if (input.window === 'visible') return 'dock'
  if (input.window === 'hidden') return 'show-window'
  return input.panelOpen ? 'background' : 'show-panel'
}
