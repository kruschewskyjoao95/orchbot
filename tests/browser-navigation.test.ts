import { describe, expect, it } from 'vitest'
import { type NavigationSurface, afterBrowserNavigation } from '../src/backend/browser/driver'

function surface(startUrl: string) {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>()
  const state = { url: startUrl, title: 'Atual' }
  let wentBack = false
  const wc: NavigationSurface = {
    navigationHistory: {
      canGoBack: () => true,
      canGoForward: () => false,
      goBack() {
        wentBack = true
        setTimeout(() => {
          state.url = 'https://antes.example/'
          state.title = 'Antes'
          for (const fn of listeners.get('did-navigate') ?? []) fn()
        }, 0)
      },
      goForward() {},
    },
    reload() {
      setTimeout(() => {
        state.title = 'Recarregada'
        for (const fn of listeners.get('did-finish-load') ?? []) fn()
      }, 0)
    },
    getTitle: () => state.title,
    getURL: () => state.url,
    on(event, listener) {
      const set = listeners.get(event) ?? new Set()
      set.add(listener)
      listeners.set(event, set)
    },
    removeListener(event, listener) {
      listeners.get(event)?.delete(listener)
    },
  }
  return { wc, state, wentBack: () => wentBack, listeners }
}

describe('navegação do navegador embutido', () => {
  it('grava a url nova só depois que a página voltou', async () => {
    const { wc, state } = surface('https://agora.example/')
    const pending = afterBrowserNavigation(wc, 'back', state.url)
    expect(state.url).toBe('https://agora.example/')
    await expect(pending).resolves.toEqual({
      title: 'Antes',
      url: 'https://antes.example/',
    })
  })

  it('recarregar espera o fim da carga antes de ler o título', async () => {
    const { wc } = surface('https://agora.example/')
    await expect(afterBrowserNavigation(wc, 'reload', 'https://agora.example/')).resolves.toEqual({
      title: 'Recarregada',
      url: 'https://agora.example/',
    })
  })

  it('voltar para um #âncora da mesma página termina sem esperar o tempo-limite', async () => {
    const { wc, state, listeners } = surface('https://agora.example/#fim')
    wc.navigationHistory.goBack = () => {
      setTimeout(() => {
        state.url = 'https://agora.example/'
        for (const fn of listeners.get('did-navigate-in-page') ?? []) fn()
      }, 0)
    }
    await expect(afterBrowserNavigation(wc, 'back', state.url, 500)).resolves.toEqual({
      title: 'Atual',
      url: 'https://agora.example/',
    })
  })

  it('sem histórico não chama voltar', async () => {
    const { wc, wentBack } = surface('https://agora.example/')
    wc.navigationHistory.canGoBack = () => false
    await expect(afterBrowserNavigation(wc, 'back', 'https://agora.example/')).rejects.toThrow(
      'Não há página anterior.',
    )
    expect(wentBack()).toBe(false)
  })

  it('falha da página principal devolve o erro e não grava a url antiga como sucesso', async () => {
    const { wc, listeners } = surface('https://agora.example/')
    wc.navigationHistory.goBack = () => {
      setTimeout(() => {
        for (const fn of listeners.get('did-fail-load') ?? [])
          fn({}, -105, 'ERR_NAME_NOT_RESOLVED', 'https://antes.example/', true)
      }, 0)
    }
    await expect(afterBrowserNavigation(wc, 'back', 'https://agora.example/')).rejects.toThrow(
      'ERR_NAME_NOT_RESOLVED',
    )
  })
})
