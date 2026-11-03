import { describe, expect, it } from 'vitest'
import {
  checkProviderUpdate,
  compareSemver,
  parseSemver,
} from '../src/backend/updates/update-checker'

describe('Atualizações de provedores (Claude/Codex/Gemini...)', () => {
  it('extrai semver de saídas reais das CLIs', () => {
    expect(parseSemver('codex-cli 0.165.0')).toBe('0.165.0')
    expect(parseSemver('2.1.317 (Claude Code)')).toBe('2.1.317')
    expect(parseSemver('GitHub Copilot CLI 1.0.105.')).toBe('1.0.105')
    expect(parseSemver('Muse Code 1.4.14 (1.4.14-R7309.1)')).toBe('1.4.14')
    expect(parseSemver('sem versão')).toBeNull()
    expect(compareSemver('0.166.0', '0.165.0')).toBe(1)
    expect(compareSemver('2.1.317', '2.1.317')).toBe(0)
    expect(compareSemver('1.4.4', '1.4.5')).toBe(-1)
  })

  it('detecta update quando o npm tem versão maior', async () => {
    const fakeFetch = (async () =>
      new Response(JSON.stringify({ version: '0.166.0' }), { status: 200 })) as typeof fetch
    const info = await checkProviderUpdate('codex', 'codex-cli 0.165.0', fakeFetch)
    expect(info.updateAvailable).toBe(true)
    expect(info.installedVersion).toBe('0.165.0')
    expect(info.latestVersion).toBe('0.166.0')
    expect(info.updateCommand).toContain('@openai/codex')
  })

  it('não acusa update quando já está na última', async () => {
    const fakeFetch = (async () =>
      new Response(JSON.stringify({ version: '2.1.317' }), { status: 200 })) as typeof fetch
    const info = await checkProviderUpdate('claude', '2.1.317 (Claude Code)', fakeFetch)
    expect(info.updateAvailable).toBe(false)
  })

  it('provedor fora do npm não quebra e explica', async () => {
    const info = await checkProviderUpdate('antigravity', '1.4.12')
    expect(info.updateAvailable).toBe(false)
    expect(info.updateCommand).toBeNull()
    expect(info.error).toContain('npm')
  })
})
