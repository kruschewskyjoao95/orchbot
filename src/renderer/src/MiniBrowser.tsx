import { type Component, createEffect, createSignal, onCleanup, onMount } from 'solid-js'
import type { BrowserTab } from '../../shared/types'
import { liveBrowserBounds, resizedBrowserSize } from './live-browser-bounds'

const MIN_WIDTH = 280
const MIN_HEIGHT = 220
let rememberedSize = { width: 420, height: 360 }

export const MiniBrowser: Component<{
  tab: BrowserTab
  scale: number
  onHide: () => void
  onPopOut: () => void
  onCloseTab: () => void
}> = (props) => {
  let hole: HTMLDivElement | undefined
  let panel: HTMLElement | undefined
  let disposed = false
  const [size, setSize] = createSignal(rememberedSize)
  onCleanup(() => {
    disposed = true
  })

  const place = () => {
    if (disposed || !hole || !window.orchbot.browserSetBounds) return
    const covered = Boolean(document.querySelector('.modal-overlay, .settings-overlay'))
    void window.orchbot.browserSetBounds(
      props.tab.agentId,
      props.tab.id,
      liveBrowserBounds(hole.getBoundingClientRect(), covered),
    )
  }

  createEffect(() => {
    const agentId = props.tab.agentId
    const tabId = props.tab.id
    onCleanup(() => {
      void window.orchbot.browserSetBounds?.(agentId, tabId, null)
    })
  })

  createEffect(() => {
    void props.tab.id
    void props.tab.isLoading
    void props.scale
    requestAnimationFrame(place)
  })

  onMount(() => {
    const ro = new ResizeObserver(() => place())
    if (hole) ro.observe(hole)
    const onResize = () => place()
    window.addEventListener('resize', onResize)
    const mo = new MutationObserver((records) => {
      const changed = records.some((record) =>
        [...record.addedNodes, ...record.removedNodes].some(
          (node) =>
            node instanceof Element &&
            (node.matches('.modal-overlay, .settings-overlay') ||
              Boolean(node.querySelector('.modal-overlay, .settings-overlay'))),
        ),
      )
      if (changed) place()
    })
    mo.observe(document.body, { childList: true, subtree: true })
    onCleanup(() => {
      ro.disconnect()
      window.removeEventListener('resize', onResize)
      mo.disconnect()
    })
  })

  const onResizePointerDown = (event: PointerEvent) => {
    if (!panel) return
    event.preventDefault()
    const handle = event.currentTarget as HTMLElement
    handle.setPointerCapture(event.pointerId)
    const zoom = props.scale / 100 || 1
    const bounds = panel.getBoundingClientRect()
    const parent = panel.parentElement?.getBoundingClientRect()
    const start = {
      width: bounds.width / zoom,
      height: bounds.height / zoom,
      pointerX: event.clientX / zoom,
      pointerY: event.clientY / zoom,
    }
    const limits = {
      minWidth: MIN_WIDTH,
      minHeight: MIN_HEIGHT,
      maxWidth: Math.max(MIN_WIDTH, (parent?.width ?? window.innerWidth) / zoom - 24),
      maxHeight: Math.max(MIN_HEIGHT, (parent?.height ?? window.innerHeight) / zoom - 64),
    }
    const move = (ev: PointerEvent) => {
      const next = resizedBrowserSize(start, { x: ev.clientX / zoom, y: ev.clientY / zoom }, limits)
      rememberedSize = next
      setSize(next)
      requestAnimationFrame(place)
    }
    const stop = (ev: PointerEvent) => {
      handle.releasePointerCapture(ev.pointerId)
      handle.removeEventListener('pointermove', move)
      handle.removeEventListener('pointerup', stop)
      handle.removeEventListener('pointercancel', stop)
    }
    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', stop)
    handle.addEventListener('pointercancel', stop)
  }

  return (
    <aside
      class="mini-browser"
      aria-label="Página aberta pelo agente"
      ref={panel}
      style={{ width: `${size().width}px`, height: `${size().height}px` }}
    >
      <div class="mini-browser-bar">
        <span class="mini-browser-title" title={props.tab.url}>
          {props.tab.isLoading ? 'Carregando…' : props.tab.title || props.tab.url}
        </span>
        <button
          type="button"
          class="btn-outline mini-browser-btn"
          title="Abre a página numa janela. Fechar a janela deixa a página rodando."
          onClick={props.onPopOut}
        >
          Janela
        </button>
        <button
          type="button"
          class="btn-outline mini-browser-btn"
          title="Tira a página da tela. Ela continua aberta para o agente."
          onClick={props.onHide}
        >
          Segundo plano
        </button>
        <button
          type="button"
          class="btn-outline mini-browser-btn"
          onClick={props.onCloseTab}
          aria-label="Fechar aba"
        >
          Fechar
        </button>
      </div>
      <div class="mini-browser-stage">
        <div class="mini-browser-hole" ref={hole} />
        <button
          type="button"
          class="mini-browser-resize"
          aria-label="Redimensionar a página"
          title="Arraste para aumentar ou diminuir"
          onPointerDown={onResizePointerDown}
        />
      </div>
    </aside>
  )
}
