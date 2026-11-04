import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { OrchbotDatabase } from '../src/backend/storage/db'
import { DEFAULT_APP_SETTINGS } from '../src/shared/types'

describe('Configurações do app (Geral/Aparência/Conversas/Comportamento/Permissões)', () => {
  it('retorna padrões e persiste alterações parciais', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'orchbot-settings-'))
    const db = new OrchbotDatabase(path.join(tmp, 't.db'))

    expect(db.getSettings()).toEqual(DEFAULT_APP_SETTINGS)

    const updated = db.updateSettings({
      theme: 'system',
      uiScale: 110,
      sendShortcut: 'ctrl-enter',
      shareAnalytics: true,
      lastAgentId: 'agent-1',
    })
    expect(updated.theme).toBe('system')
    expect(updated.uiScale).toBe(110)
    expect(updated.sendShortcut).toBe('ctrl-enter')
    expect(updated.shareAnalytics).toBe(true)
    expect(updated.keepRunningInBackground).toBe(false)

    // Reabre e confere persistência
    db.close()
    const reopened = new OrchbotDatabase(path.join(tmp, 't.db'))
    expect(reopened.getSettings().lastAgentId).toBe('agent-1')
    expect(reopened.getSettings().theme).toBe('system')
    reopened.close()
    fs.rmSync(tmp, { recursive: true, force: true })
  })
})

describe('Provedor principal', () => {
  it('usa o principal se ativo; senão o primeiro pronto; senão o primeiro ativo', async () => {
    const { principalConnection } = await import('../src/shared/provider-status')
    const conns = [
      { providerId: 'codex', enabled: true, readiness: 'login_required' },
      { providerId: 'claude', enabled: true, readiness: 'ready' },
      { providerId: 'grok', enabled: false, readiness: 'ready' },
    ] as const
    const list = conns.map((c) => ({ ...c }))
    expect(principalConnection(list, 'codex')?.providerId).toBe('codex')
    expect(principalConnection(list, 'grok')?.providerId).toBe('claude')
    expect(principalConnection(list, '')?.providerId).toBe('claude')
    expect(principalConnection([list[0]], '')?.providerId).toBe('codex')
    expect(principalConnection([list[2]], 'grok')).toBeUndefined()
  })
})
