import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { checkCliAvailability } from '../src/backend/providers/cli-utils'

const fixture = fileURLToPath(new URL('./fixtures/auth-cli.mjs', import.meta.url))
describe('Provider login readiness', () => {
  let dir: string
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orchbot-auth-'))
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    fs.rmSync(dir, { recursive: true, force: true })
  })
  function command(mode: string) {
    const file = path.join(dir, mode)
    fs.copyFileSync(fixture, file)
    fs.chmodSync(file, 0o755)
    return file
  }
  const calls = (): string[][] =>
    fs
      .readFileSync(path.join(dir, 'calls.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))

  it('does not treat an API key as an installed CLI', async () => {
    const status = await checkCliAvailability('codex', {
      cliPath: path.join(dir, 'absent'),
      apiKey: 'runtime-secret',
    })
    expect(status).toMatchObject({ available: false, readiness: 'not_installed' })
    expect(JSON.stringify(status)).not.toContain('runtime-secret')
  })
  it('separates broken/non-executable installations from missing CLIs', async () => {
    expect(
      await checkCliAvailability('codex', { cliPath: command('version-error') }),
    ).toMatchObject({ available: false, readiness: 'error' })
    const file = command('no-permission')
    fs.chmodSync(file, 0o600)
    expect(await checkCliAvailability('codex', { cliPath: file })).toMatchObject({
      available: false,
      readiness: 'error',
    })
  })
  it.each(['codex', 'claude'] as const)(
    'uses the actual %s auth command to distinguish login from installation',
    async (provider) => {
      expect(await checkCliAvailability(provider, { cliPath: command('ready') })).toMatchObject({
        available: true,
        readiness: 'ready',
      })
      expect(
        await checkCliAvailability(provider, { cliPath: command('logged-out') }),
      ).toMatchObject({ available: true, readiness: 'login_required', authStatus: 'missing' })
      expect(calls()[1]).toEqual(
        provider === 'codex' ? ['login', 'status'] : ['auth', 'status', '--json'],
      )
    },
  )
  it('uses the configured key in the same environment as execution without returning identity or secrets', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', undefined)
    const status = await checkCliAvailability('claude', {
      cliPath: command('environment'),
      apiKey: 'runtime-secret',
    })
    expect(status.readiness).toBe('ready')
    const serialized = JSON.stringify(status)
    for (const secret of ['runtime-secret', 'private-stored-secret', 'private@example.com'])
      expect(serialized).not.toContain(secret)
  })
  it('redacts known credentials from the version and hides raw auth diagnostics', async () => {
    vi.stubEnv('CODEX_API_KEY', 'runtime-secret')
    const version = await checkCliAvailability('codex', { cliPath: command('secret-version') })
    expect(version.readiness).toBe('ready')
    expect(version.version).toContain('[REDACTED]')
    expect(JSON.stringify(version)).not.toContain('runtime-secret')
    const broken = await checkCliAvailability('codex', { cliPath: command('broken') })
    expect(broken.readiness).toBe('error')
    expect(JSON.stringify(broken)).not.toContain('runtime-secret')
    expect(JSON.stringify(broken)).not.toContain('private diagnostic')
  })
  it('redacts long credentials before truncating version output', async () => {
    const secret = `secret-${'x'.repeat(300)}`
    vi.stubEnv('CODEX_API_KEY', secret)
    const status = await checkCliAvailability('codex', { cliPath: command('secret-version') })
    expect(status.version).toContain('[REDACTED]')
    expect(JSON.stringify(status)).not.toContain('x'.repeat(30))
  })

  it('does not mark an unsupported CLI or a key in its environment as logged in', async () => {
    const status = await checkCliAvailability('grok', {
      cliPath: command('ready'),
      apiKey: 'runtime-secret',
    })
    expect(status).toMatchObject({
      available: true,
      readiness: 'unverified',
      authStatus: 'unknown',
    })
    expect(calls()).toEqual([['--version']])
  })
  it('distinguishes unsupported status commands and unrecognized output from a missing login', async () => {
    expect(await checkCliAvailability('claude', { cliPath: command('unsupported') })).toMatchObject(
      { readiness: 'unverified' },
    )
    expect(await checkCliAvailability('claude', { cliPath: command('malformed') })).toMatchObject({
      readiness: 'unverified',
    })
  })
  it('checks Pi for the configured model without printing credentials', async () => {
    expect(
      await checkCliAvailability('pi', { cliPath: command('ready'), model: 'provider/model' }),
    ).toMatchObject({ readiness: 'ready' })
    expect(calls()[1]).toEqual(['auth', 'check', '--model', 'provider/model', '--json'])
    expect(await checkCliAvailability('pi', { cliPath: command('logged-out') })).toMatchObject({
      readiness: 'login_required',
    })
    expect(await checkCliAvailability('pi', { cliPath: command('invalid') })).toMatchObject({
      readiness: 'error',
    })
  })
  it('checks OpenCode credentials for the selected provider rather than any stored account', async () => {
    const cliPath = command('ready')
    expect(
      await checkCliAvailability('opencode', { cliPath, model: 'anthropic/model' }),
    ).toMatchObject({ readiness: 'ready' })
    expect(
      await checkCliAvailability('opencode', { cliPath, model: 'openai/model' }),
    ).toMatchObject({ readiness: 'login_required' })
    expect(await checkCliAvailability('opencode', { cliPath, model: 'local/model' })).toMatchObject(
      { readiness: 'unverified' },
    )
    expect(
      await checkCliAvailability('opencode', {
        cliPath: command('logged-out'),
        model: 'opencode-go/model',
      }),
    ).toMatchObject({ readiness: 'login_required' })
  })
  it('does not infer Muse login from an empty usage result', async () => {
    expect(await checkCliAvailability('muse', { cliPath: command('ready') })).toMatchObject({
      readiness: 'ready',
    })
    expect(await checkCliAvailability('muse', { cliPath: command('inconclusive') })).toMatchObject({
      readiness: 'unverified',
    })
    expect(await checkCliAvailability('muse', { cliPath: command('logged-out') })).toMatchObject({
      readiness: 'login_required',
    })
    expect(
      calls().every(
        (args) => args[0] === '--version' || (args[0] === 'usage' && args[1] === '--json'),
      ),
    ).toBe(true)
  })
  it('reports a timeout as a check failure, not a request to log in', async () => {
    expect(await checkCliAvailability('codex', { cliPath: command('timeout') })).toMatchObject({
      available: true,
      readiness: 'error',
      error: expect.stringContaining('tempo limite'),
    })
  }, 15000)
})
