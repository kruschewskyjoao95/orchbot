export const COMPUTER_PREVIEW_INTERVAL_MS = 1500

export function startComputerPreview(opts: {
  capture: () => Promise<string>
  onFrame: (dataUrl: string) => void
  onError?: (message: string) => void
  intervalMs?: number
}): () => void {
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const wait = opts.intervalMs ?? COMPUTER_PREVIEW_INTERVAL_MS

  const tick = async () => {
    if (stopped) return
    try {
      const frame = await opts.capture()
      if (!stopped && frame) opts.onFrame(frame)
    } catch (err) {
      if (!stopped) opts.onError?.(err instanceof Error ? err.message : String(err))
    }
    if (!stopped) timer = setTimeout(() => void tick(), wait)
  }
  void tick()
  return () => {
    stopped = true
    if (timer !== undefined) clearTimeout(timer)
  }
}
