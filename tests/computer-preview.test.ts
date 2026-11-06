import { afterEach, describe, expect, it, vi } from 'vitest'
import { startComputerPreview } from '../src/renderer/src/computer-preview'

describe('preview da tela do computador', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('entrega o primeiro frame, continua no intervalo e para de capturar', async () => {
    vi.useFakeTimers()
    const frames: string[] = []
    let n = 0
    const stop = startComputerPreview({
      capture: async () => `frame-${++n}`,
      onFrame: (frame) => {
        frames.push(frame)
      },
      intervalMs: 100,
    })

    await vi.advanceTimersByTimeAsync(0)
    expect(frames).toEqual(['frame-1'])

    await vi.advanceTimersByTimeAsync(100)
    expect(frames).toEqual(['frame-1', 'frame-2'])

    stop()
    await vi.advanceTimersByTimeAsync(400)
    expect(frames).toEqual(['frame-1', 'frame-2'])
    expect(n).toBe(2)
  })
})
