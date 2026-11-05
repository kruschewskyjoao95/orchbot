import type { BrowserBounds } from '../../shared/types'

/** Retângulo da view nativa. null esconde a página (painel pequeno demais ou diálogo por cima). */
export function liveBrowserBounds(
  rect: { x: number; y: number; width: number; height: number },
  covered: boolean,
): BrowserBounds | null {
  if (covered || rect.width < 8 || rect.height < 8) return null
  return {
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
  }
}

export interface BrowserSizeLimits {
  minWidth: number
  minHeight: number
  maxWidth: number
  maxHeight: number
}

/** Painel preso no canto direito: arrastar para a esquerda aumenta a largura, para baixo aumenta a altura. */
export function resizedBrowserSize(
  start: { width: number; height: number; pointerX: number; pointerY: number },
  pointer: { x: number; y: number },
  limits: BrowserSizeLimits,
): { width: number; height: number } {
  const clamp = (value: number, min: number, max: number) =>
    Math.round(Math.min(max, Math.max(min, value)))
  return {
    width: clamp(start.width + (start.pointerX - pointer.x), limits.minWidth, limits.maxWidth),
    height: clamp(start.height + (pointer.y - start.pointerY), limits.minHeight, limits.maxHeight),
  }
}
