import type { BrowserManager } from './browser-manager'

export interface BrowserToolDefinition {
  name: string
  description: string
  parameters: {
    type: 'object'
    properties: Record<string, { type: string; description: string }>
    required?: string[]
  }
}

export const BROWSER_TOOLS: BrowserToolDefinition[] = [
  {
    name: 'openbot_browser.open',
    description: 'Abre uma nova página web segura no navegador persistente do agente.',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL com protocolo HTTP ou HTTPS para carregar.' },
      },
      required: ['url'],
    },
  },
  {
    name: 'openbot_browser.inspect',
    description: 'Inspeciona o conteúdo DOM, links e campos da página atual de forma sanitizada.',
    parameters: {
      type: 'object',
      properties: {
        tabId: { type: 'string', description: 'ID da aba aberta. Opcional se houver apenas uma.' },
      },
    },
  },
  {
    name: 'openbot_browser.click',
    description: 'Clica em um elemento da página indicado por um seletor CSS.',
    parameters: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'Seletor CSS do elemento a ser clicado.' },
        tabId: { type: 'string', description: 'ID da aba aberta.' },
      },
      required: ['selector'],
    },
  },
  {
    name: 'openbot_browser.fill',
    description: 'Preenche um campo de formulário indicado por um seletor CSS.',
    parameters: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'Seletor CSS do campo a ser preenchido.' },
        value: { type: 'string', description: 'Valor a ser inserido no campo.' },
        tabId: { type: 'string', description: 'ID da aba aberta.' },
      },
      required: ['selector', 'value'],
    },
  },
  {
    name: 'openbot_browser.screenshot',
    description: 'Captura uma evidência visual em imagem da aba aberta.',
    parameters: {
      type: 'object',
      properties: {
        tabId: { type: 'string', description: 'ID da aba aberta.' },
      },
    },
  },
  {
    name: 'openbot_browser.close',
    description: 'Fecha uma aba do navegador.',
    parameters: {
      type: 'object',
      properties: {
        tabId: { type: 'string', description: 'ID da aba a ser fechada.' },
      },
      required: ['tabId'],
    },
  },
]

export async function executeBrowserTool(
  manager: BrowserManager,
  agentId: string,
  toolName: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const tabs = manager.getTabs(agentId)
  const defaultTabId = tabs.length > 0 ? tabs[tabs.length - 1].id : ''

  switch (toolName) {
    case 'openbot_browser.open': {
      const url = String(args.url || '')
      return await manager.openTab(agentId, url)
    }
    case 'openbot_browser.inspect': {
      const tabId = String(args.tabId || defaultTabId)
      if (!tabId) throw new Error('Nenhuma aba aberta para inspecionar')
      return await manager.inspect(agentId, tabId)
    }
    case 'openbot_browser.click': {
      const tabId = String(args.tabId || defaultTabId)
      const selector = String(args.selector || '')
      if (!tabId) throw new Error('Nenhuma aba aberta para clicar')
      if (!selector) throw new Error('Seletor obrigatório')
      const success = await manager.click(agentId, tabId, selector)
      return { success, selector, tabId }
    }
    case 'openbot_browser.fill': {
      const tabId = String(args.tabId || defaultTabId)
      const selector = String(args.selector || '')
      const value = String(args.value || '')
      if (!tabId) throw new Error('Nenhuma aba aberta para preencher')
      if (!selector) throw new Error('Seletor obrigatório')
      const success = await manager.fill(agentId, tabId, selector, value)
      return { success, selector, tabId }
    }
    case 'openbot_browser.screenshot': {
      const tabId = String(args.tabId || defaultTabId)
      if (!tabId) throw new Error('Nenhuma aba aberta para capturar tela')
      const base64 = await manager.captureScreenshot(agentId, tabId)
      return { tabId, screenshotAvailable: true, length: base64.length }
    }
    case 'openbot_browser.close': {
      const tabId = String(args.tabId || '')
      if (!tabId) throw new Error('Tab ID obrigatório')
      const success = await manager.closeTab(agentId, tabId)
      return { success, tabId }
    }
    default:
      throw new Error(`Ferramenta desconhecida: ${toolName}`)
  }
}
