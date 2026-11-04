import { beforeEach, describe, expect, it, vi } from 'vitest'

const { execFileMock } = vi.hoisted(() => ({ execFileMock: vi.fn() }))

vi.mock('node:child_process', () => {
  const custom = Symbol.for('nodejs.util.promisify.custom')
  const execFile = function execFile(this: unknown, ...args: unknown[]) {
    return execFileMock.apply(this, args)
  }
  const promisified = (
    cmd: string,
    args?: string[],
    options?: unknown,
  ): Promise<{ stdout: string; stderr: string }> =>
    new Promise((resolve, reject) => {
      execFileMock(cmd, args, options, (err: Error | null, stdout?: string, stderr?: string) => {
        if (err) reject(Object.assign(err, { stderr: stderr ?? '' }))
        else resolve({ stdout: stdout ?? '', stderr: stderr ?? '' })
      })
    })
  Object.assign(execFile, { [custom]: promisified })
  return { execFile, spawn: vi.fn() }
})

import { executeComputerAction } from '../src/backend/computer/computer-tools'

function install(found: string[], failClick?: string) {
  const calls: string[][] = []
  execFileMock.mockImplementation(
    (
      cmd: string,
      args: string[] | undefined,
      _options: unknown,
      cb: (err: Error | null, stdout?: string, stderr?: string) => void,
    ) => {
      const argv = args ?? []
      if (cmd === 'which') {
        const name = argv[0] ?? ''
        if (!found.includes(name)) {
          cb(new Error('not found'), '', '')
          return
        }
        cb(null, `/usr/bin/${name}\n`, '')
        return
      }
      calls.push([cmd, ...argv])
      if (failClick && cmd === failClick && argv[0] === 'click') {
        cb(new Error(`Command failed: ${cmd} click`), '', 'ydotoold: permission denied')
        return
      }
      cb(null, '', '')
    },
  )
  return calls
}

describe('Clique no desktop', () => {
  beforeEach(() => {
    execFileMock.mockReset()
  })

  it('usa ydotool e não chama hyprctl dispatch mouse', async () => {
    const calls = install(['grim', 'hyprctl', 'wtype', 'ydotool'])
    const result = await executeComputerAction('click', { x: 12, y: 34 }, '/tmp')
    expect(result.summary).toBe('Clique em 12,34.')
    expect(calls).toEqual([
      ['ydotool', 'mousemove', '--absolute', '-x', '12', '-y', '34'],
      ['ydotool', 'click', '0xC0'],
    ])
  })

  it('cai no xdotool quando não há ydotool', async () => {
    const calls = install(['hyprctl', 'wtype', 'xdotool'])
    await executeComputerAction('click', { x: 8, y: 9 }, '/tmp')
    expect(calls).toEqual([['xdotool', 'mousemove', '8', '9', 'click', '1']])
  })

  it('devolve o erro do clique em vez de dizer que tentou', async () => {
    install(['hyprctl', 'ydotool'], 'ydotool')
    await expect(executeComputerAction('click', { x: 1, y: 2 }, '/tmp')).rejects.toThrow(
      'ydotoold: permission denied',
    )
  })

  it('sem ferramenta de clique, falha mesmo com hyprctl instalado', async () => {
    const calls = install(['grim', 'hyprctl', 'wtype'])
    await expect(executeComputerAction('click', { x: 1, y: 2 }, '/tmp')).rejects.toThrow(
      'sem ydotool ou xdotool',
    )
    expect(calls).toEqual([])
  })
})
