import { onCleanup, onMount } from 'solid-js'

/** Mantém Tab no diálogo sem mudar a ordem dos controles nem o fechamento existente. */
export function focusDialog(dialog: HTMLDialogElement) {
  const previous = document.activeElement
  const controls = () =>
    [
      ...dialog.querySelectorAll<HTMLElement>(
        'button, input, select, textarea, a[href], summary, [tabindex]',
      ),
    ].filter(
      (element) =>
        element.tabIndex >= 0 &&
        !element.matches(':disabled') &&
        element.getClientRects().length > 0,
    )
  const onKey = (event: KeyboardEvent) => {
    if (event.key !== 'Tab') return
    const items = controls()
    const first = items[0]
    const last = items.at(-1)
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last?.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first?.focus()
    }
  }
  dialog.addEventListener('keydown', onKey, true)
  onMount(() => controls()[0]?.focus())
  onCleanup(() => {
    dialog.removeEventListener('keydown', onKey, true)
    if (previous instanceof HTMLElement && previous.isConnected) previous.focus()
  })
}
