import { describe, expect, it } from 'vitest'
import { pageWindowAction } from '../src/renderer/src/page-window-action'

describe('pageWindowAction', () => {
  it('escolhe segundo plano, a janela ou a conversa', () => {
    expect(pageWindowAction({ hasTab: false, panelOpen: true, window: 'none' })).toBeNull()
    expect(pageWindowAction({ hasTab: true, panelOpen: true, window: 'none' })).toBe('background')
    expect(pageWindowAction({ hasTab: true, panelOpen: false, window: 'none' })).toBe('show-panel')
    expect(pageWindowAction({ hasTab: true, panelOpen: false, window: 'hidden' })).toBe(
      'show-window',
    )
    expect(pageWindowAction({ hasTab: true, panelOpen: true, window: 'hidden' })).toBe(
      'show-window',
    )
    expect(pageWindowAction({ hasTab: true, panelOpen: false, window: 'visible' })).toBe('dock')
    expect(pageWindowAction({ hasTab: true, panelOpen: true, window: 'visible' })).toBe('dock')
  })
})
