import { describe, expect, it } from 'vitest'
import { liveBrowserBounds, resizedBrowserSize } from '../src/renderer/src/live-browser-bounds'

describe('liveBrowserBounds', () => {
  it('arredonda o retângulo visível e esconde quando um diálogo cobre a página', () => {
    expect(liveBrowserBounds({ x: 10.4, y: 20.6, width: 300.2, height: 200.8 }, false)).toEqual({
      x: 10,
      y: 21,
      width: 300,
      height: 201,
    })
    expect(liveBrowserBounds({ x: 0, y: 0, width: 4, height: 200 }, false)).toBeNull()
    expect(liveBrowserBounds({ x: 10, y: 20, width: 300, height: 200 }, true)).toBeNull()
  })

  it('aumenta para a esquerda e para baixo, e respeita o mínimo e o máximo', () => {
    const limits = { minWidth: 280, minHeight: 220, maxWidth: 800, maxHeight: 600 }
    const start = { width: 420, height: 360, pointerX: 100, pointerY: 100 }
    expect(resizedBrowserSize(start, { x: 80, y: 160 }, limits)).toEqual({
      width: 440,
      height: 420,
    })
    expect(resizedBrowserSize(start, { x: 400, y: 0 }, limits)).toEqual({
      width: 280,
      height: 260,
    })
    expect(resizedBrowserSize(start, { x: -500, y: 900 }, limits)).toEqual({
      width: 800,
      height: 600,
    })
  })
})
