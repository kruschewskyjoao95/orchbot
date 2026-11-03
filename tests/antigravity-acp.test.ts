import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { AntigravityAdapter } from '../src/backend/providers/antigravity-adapter'
import {
  guardedLaunch,
  resolveAntigravityServer,
  rttimeLimited,
} from '../src/backend/providers/antigravity-server'

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'agy-'))
const exe = (file: string, body = '\x7fELF') => {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, body, { mode: 0o755 })
  return file
}
const fixture = fileURLToPath(new URL('./fixtures/acp-agent.mjs', import.meta.url))

describe('Antigravity via servidor ACP', () => {
  it('acha o agy_acp_server na ordem certa e nunca confunde com agy/antigravity', () => {
    const home = tmp()
    const share = path.join(home, '.local', 'share', 'antigravity-acp')
    const managed = exe(
      path.join(
        home,
        '.config',
        'OpenBot',
        'provider-runtimes',
        'antigravity',
        `${process.platform}-x64`,
        '1.4.4',
        'bin',
        'agy_acp_server.par',
      ),
    )
    expect(resolveAntigravityServer(undefined, home, {})).toBe(managed)

    exe(path.join(share, '1.4.1', 'agy_acp_server.par'))
    const newer = exe(path.join(share, '1.10.0', 'agy_acp_server.par'))
    expect(resolveAntigravityServer(undefined, home, {})).toBe(newer) // 1.10 > 1.4, comparação numérica

    const wrapper = exe(path.join(share, 'wrapper', 'agy_acp_server.par'), '#!/usr/bin/env bash\n')
    expect(resolveAntigravityServer(undefined, home, {})).toBe(wrapper)

    const fromEnv = exe(path.join(home, 'meu', 'servidor'))
    expect(resolveAntigravityServer(undefined, home, { ORCHBOT_ANTIGRAVITY_PATH: fromEnv })).toBe(
      fromEnv,
    )
    expect(
      resolveAntigravityServer('/opt/x/meu-servidor', home, { ORCHBOT_ANTIGRAVITY_PATH: fromEnv }),
    ).toBe('/opt/x/meu-servidor')
    // o IDE (`antigravity`) e a CLI (`agy`) configurados como caminho são ignorados
    expect(resolveAntigravityServer('/usr/bin/antigravity', home, {})).toBe(wrapper)
    expect(resolveAntigravityServer('agy', home, {})).toBe(wrapper)
    expect(resolveAntigravityServer(undefined, tmp(), {})).toBeUndefined()
  })

  it('detecta o limite de RTTIME herdado e só desvia pelo systemd-run quando necessário', () => {
    if (process.platform === 'linux') {
      expect(
        rttimeLimited('Max realtime timeout        0                    0                    us'),
      ).toBe(true)
      expect(
        rttimeLimited('Max realtime timeout        unlimited            unlimited            us'),
      ).toBe(false)
    }
    const bin = exe(path.join(tmp(), 'servidor'))
    const direct = guardedLaunch(bin, ['--x'], '/w', {}, false)
    expect(direct).toEqual({ command: bin, args: ['--x'] })

    const guarded = guardedLaunch(
      bin,
      ['--x'],
      '/w',
      { HOME: '/h', GEMINI_API_KEY: 'segredo-123' },
      true,
    )
    expect(guarded.command).toBe('systemd-run')
    expect(guarded.args).toContain('LimitRTTIME=infinity')
    expect(guarded.args.join(' ')).toMatch(/--unit=orchbot-agy-[0-9a-f]{8}/)
    expect(guarded.args.join(' ')).not.toContain('segredo-123') // só o NOME da variável, nunca o valor
    expect(guarded.args.slice(-2)).toEqual([bin, '--x'])
    guarded.cleanup?.()

    const script = exe(path.join(tmp(), 'wrapper'), '#!/usr/bin/env bash\n')
    expect(guardedLaunch(script, [], '/w', {}, true)).toEqual({ command: script, args: [] })
  })

  it('se apresenta como "zed" no initialize e usa o ACP de ponta a ponta', async () => {
    const log = path.join(tmp(), 'wire.log')
    process.env.ORCHBOT_NO_RTTIME_GUARD = '1'
    try {
      const done = await new Promise<string>((resolve) => {
        new AntigravityAdapter().executeTurn(
          'oi',
          {
            workspacePath: process.cwd(),
            providerConfig: { cliPath: process.execPath, cliArgs: [fixture, 'normal', log] },
          },
          { onChunk() {}, onDone: (t) => resolve(t), onError: (e) => resolve(`ERRO ${e}`) },
        )
      })
      expect(done).not.toContain('ERRO')
      const init = fs
        .readFileSync(log, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l))
        .find((m) => m.method === 'initialize')
      expect(init.params.clientInfo.name).toBe('zed')
    } finally {
      Reflect.deleteProperty(process.env, 'ORCHBOT_NO_RTTIME_GUARD')
    }
  })

  const hasSystemd = (() => {
    try {
      execFileSync('systemd-run', ['--version'], { stdio: 'ignore' })
      return rttimeLimited()
    } catch {
      return false
    }
  })()
  it.runIf(hasSystemd)(
    'com RTTIME limitado roda pelo systemd-run e NÃO deixa a unidade para trás',
    async () => {
      const result = await new Promise<string>((resolve) => {
        new AntigravityAdapter().executeTurn(
          'oi',
          {
            workspacePath: process.cwd(),
            providerConfig: { cliPath: process.execPath, cliArgs: [fixture, 'normal'] },
          },
          { onChunk() {}, onDone: (t) => resolve(t), onError: (e) => resolve(`ERRO ${e}`) },
        )
      })
      expect(result).not.toContain('ERRO')
      await new Promise((r) => setTimeout(r, 2500))
      const left = execFileSync(
        'systemctl',
        ['--user', 'list-units', 'orchbot-agy-*', '--no-legend'],
        { encoding: 'utf8' },
      ).trim()
      expect(left).toBe('')
    },
  )
})
