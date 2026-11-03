import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { buildDiagnostics, redactText } from '../src/backend/diagnostics/diagnostics'
import {
  getManagedInfo,
  installManagedCli,
  managedBinPath,
  removeManagedCli,
  setManagedCliRoot,
  setManagedPin,
} from '../src/backend/providers/managed-cli'
import { QueueManager } from '../src/backend/queue/queue-manager'
import { detectLocalRuntimes } from '../src/backend/runtimes/local-runtimes'
import { OrchbotDatabase } from '../src/backend/storage/db'
import {
  loadThemes,
  parsePlainToml,
  parseThemeJson,
  varsFromPalette,
  watchThemes,
} from '../src/backend/themes/theme-service'
import { SELF_UPDATE } from '../src/backend/updates/self-update'
import { parseDeepLink } from '../src/main/deep-link'
import { registerAppImageDesktop, setLinuxAutostart } from '../src/main/linux-desktop'
import { testSecretStorage } from './secret-storage-fixture'

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'dist-'))

describe('diagnóstico sem segredos', () => {
  it('redige chaves, credenciais em URL e a pasta pessoal', () => {
    const out = redactText(
      `falhou em ${os.homedir()}/proj com sk-abcdefghijklmnopqrstuvwx e https://user:senha123@host.dev/x api_key=abcdef123456`,
    )
    expect(out).not.toMatch(/sk-abcdef|senha123|abcdef123456/)
    expect(out).not.toContain(os.homedir())
    expect(out).toContain('~/proj')
  })

  it('o relatório não contém mensagens, instruções, chaves nem env de MCP', () => {
    const db = new OrchbotDatabase(':memory:', testSecretStorage)
    const agent = db.createAgent({
      name: 'Segredo-Agente',
      workspacePath: os.tmpdir(),
      provider: 'codex',
      model: 'm',
      instructions: 'INSTRUCAO-PRIVADA',
    } as never)
    db.addMessage(db.listThreads(agent.id)[0].id, 'user', 'MENSAGEM-PRIVADA')
    db.saveMcpServer({
      name: 'gh',
      transport: 'stdio',
      command: 'x',
      env: { TOKEN: 'TOKEN-SECRETO-123' },
    })
    const custom = db.createCustomProvider({
      name: 'Meu',
      endpoint: 'https://api-privada.example.dev/v1',
      defaultModel: 'm',
      apiKey: 'CHAVE-SECRETA-999',
    })
    const task = db.enqueueTask(agent.id, db.listThreads(agent.id)[0].id, 'p', 1)
    db.updateTaskStatus(
      task.id,
      'failed',
      `erro com sk-abcdefghijklmnopqrstuvwx em ${os.homedir()}`,
    )

    const json = JSON.stringify(
      buildDiagnostics(db, {
        appVersion: '1.0.0',
        providers: { codex: { available: true, version: '1.2.3' } },
      }),
    )
    for (const secret of [
      'MENSAGEM-PRIVADA',
      'INSTRUCAO-PRIVADA',
      'TOKEN-SECRETO-123',
      'CHAVE-SECRETA-999',
      'api-privada.example.dev',
      'Segredo-Agente',
      'sk-abcdefghijklmnop',
      os.homedir(),
    ])
      expect(json).not.toContain(secret)
    expect(json).toContain('"agents":1')
    expect(json).toContain('"version":"1.2.3"')
    expect(custom.providerId.startsWith('custom:')).toBe(true)
  })
})

describe('runtimes locais', () => {
  const fake = (routes: Record<string, unknown>) =>
    (async (url: string) => {
      if (!(url in routes)) throw new Error('recusado')
      return { ok: true, json: async () => routes[url] }
    }) as unknown as typeof fetch

  it('detecta Ollama e LM Studio e marca os já configurados', async () => {
    const found = await detectLocalRuntimes(
      ['http://localhost:11434/v1/'],
      fake({
        'http://127.0.0.1:11434/api/tags': { models: [{ name: 'llama3' }] },
        'http://127.0.0.1:1234/v1/models': { data: [{ id: 'qwen' }] },
      }),
    )
    expect(found).toEqual([
      {
        id: 'ollama',
        name: 'Ollama',
        endpoint: 'http://127.0.0.1:11434/v1',
        models: ['llama3'],
        configured: true,
      },
      {
        id: 'lmstudio',
        name: 'LM Studio',
        endpoint: 'http://127.0.0.1:1234/v1',
        models: ['qwen'],
        configured: false,
      },
    ])
    expect(await detectLocalRuntimes([], fake({}))).toEqual([])
  })
})

describe('temas', () => {
  it('converte paleta Omarchy e aceita JSON com vars seguras', () => {
    const toml = parsePlainToml(
      'mode = "dark"\naccent = "#E36B2C"\nbackground = "#151718" # comentário\nforeground = "#D8D0B8"',
    )
    expect(toml).toMatchObject({ mode: 'dark', accent: '#E36B2C', background: '#151718' })
    const vars = varsFromPalette(toml, 'dark')
    expect(vars['--bg-main']).toBe('#151718')
    expect(vars['--accent']).toBe('#e36b2c')
    expect(vars['--accent-dim']).toBe('rgba(227, 107, 44, 0.16)')

    const t = parseThemeJson(
      JSON.stringify({
        name: 'X',
        vars: { '--bg-main': '#000', '--evil': 'url(http://x)', '--ok;': 'red', color: 'red' },
      }),
      'x.json',
    )
    expect(t.vars).toEqual({ '--bg-main': '#000' })
    expect(() => parseThemeJson('{}', 'v.json')).toThrow()
  })

  it('lista temas do usuário e do Omarchy ignorando arquivos quebrados, e avisa mudanças ao vivo', async () => {
    const user = tmp()
    const omarchy = tmp()
    fs.writeFileSync(
      path.join(user, 'bom.json'),
      JSON.stringify({ name: 'Bom', colors: { background: '#111111', foreground: '#eeeeee' } }),
    )
    fs.writeFileSync(path.join(user, 'ruim.json'), '{nao é json')
    fs.mkdirSync(path.join(omarchy, 'apollo'))
    fs.writeFileSync(
      path.join(omarchy, 'apollo', 'colors.toml'),
      'mode = "light"\nbackground = "#ffffff"\nforeground = "#222222"',
    )
    const themes = loadThemes(user, omarchy)
    expect(themes.map((t) => t.id)).toEqual(['bom.json', 'omarchy:apollo'])
    expect(themes[1].mode).toBe('light')

    let changed = 0
    const stop = watchThemes([user], () => changed++)
    await new Promise((r) => setTimeout(r, 100))
    fs.writeFileSync(path.join(user, 'novo.json'), '{}')
    await new Promise((r) => setTimeout(r, 600))
    stop()
    expect(changed).toBeGreaterThan(0)

    // Editar o colors.toml dentro da subpasta também avisa (fs.watch não é recursivo no Linux).
    changed = 0
    const stopOmarchy = watchThemes([omarchy], () => changed++)
    await new Promise((r) => setTimeout(r, 100))
    fs.appendFileSync(path.join(omarchy, 'apollo', 'colors.toml'), '\naccent = "#ff0000"')
    await new Promise((r) => setTimeout(r, 600))
    stopOmarchy()
    expect(changed).toBeGreaterThan(0)
  })
})

describe('integração com o desktop Linux', () => {
  it('autostart XDG liga e desliga; AppImage ganha .desktop com o esquema orchbot', () => {
    const home = tmp()
    const auto = path.join(home, '.config', 'autostart', 'orchbot.desktop')
    setLinuxAutostart(true, '/opt/Meu App/orchbot', 'orchbot', home)
    expect(fs.readFileSync(auto, 'utf8')).toContain('Exec="/opt/Meu App/orchbot"')
    setLinuxAutostart(false, '/opt/Meu App/orchbot', 'orchbot', home)
    expect(fs.existsSync(auto)).toBe(false)

    const icon = path.join(home, 'icon.png')
    fs.writeFileSync(icon, 'png')
    registerAppImageDesktop('/home/x/Orchbot.AppImage', icon, home, false)
    const entry = fs.readFileSync(
      path.join(home, '.local', 'share', 'applications', 'orchbot.desktop'),
      'utf8',
    )
    expect(entry).toContain('Exec="/home/x/Orchbot.AppImage" %U')
    expect(entry).toContain('MimeType=x-scheme-handler/orchbot;')
    expect(fs.existsSync(path.join(home, '.local', 'share', 'icons', 'orchbot.png'))).toBe(true)
  })
})

describe('link orchbot://', () => {
  it('aceita só destinos conhecidos e rejeita o resto', () => {
    expect(parseDeepLink('orchbot://agent/1f2e3d4c-aaaa-bbbb-cccc-1234567890ab')).toEqual({
      kind: 'agent',
      id: '1f2e3d4c-aaaa-bbbb-cccc-1234567890ab',
    })
    expect(parseDeepLink('orchbot://channel/abcdef12')).toEqual({ kind: 'channel', id: 'abcdef12' })
    expect(parseDeepLink('orchbot://new-agent')).toEqual({ kind: 'new-agent' })
    expect(parseDeepLink('orchbot://skills')).toEqual({ kind: 'section', name: 'skills' })
    for (const bad of [
      'https://x.dev',
      'orchbot://agent/../../etc',
      'orchbot://agent/',
      'orchbot://run/rm',
      'orchbot://skills/x',
      'lixo',
      'orchbot://agent/a b c d e f g h',
      'orchbot://agent/%E0%A4%A',
    ])
      expect(parseDeepLink(bad)).toBeNull()
  })
})

describe('CLI gerenciado', () => {
  beforeEach(() => setManagedCliRoot(tmp()))

  const fakeNpm = (version: string) => async (_cmd: string, args: string[]) => {
    const prefix = args[args.indexOf('--prefix') + 1]
    const bin = path.join(prefix, 'node_modules', '.bin')
    fs.mkdirSync(bin, { recursive: true })
    fs.writeFileSync(path.join(bin, 'codex'), '#!/bin/sh\n', { mode: 0o755 })
    fs.mkdirSync(path.join(prefix, 'node_modules', '@openai', 'codex'), { recursive: true })
    fs.writeFileSync(
      path.join(prefix, 'node_modules', '@openai', 'codex', 'package.json'),
      JSON.stringify({ version }),
    )
  }

  it('instala numa pasta própria, fixa a versão e remove', async () => {
    expect(managedBinPath('codex')).toBeUndefined()
    const info = await installManagedCli('codex', '0.5.0', true, fakeNpm('0.5.0'))
    expect(info).toMatchObject({ installed: true, version: '0.5.0', pinned: true })
    expect(managedBinPath('codex')).toMatch(/node_modules\/\.bin\/codex$/)
    expect(setManagedPin('codex', false).pinned).toBe(false)
    expect(removeManagedCli('codex').installed).toBe(false)
    expect(getManagedInfo('codex').installed).toBe(false)
  })

  it('valida versão e provedores fora do npm', async () => {
    await expect(installManagedCli('codex', '1.0; rm -rf /', true, fakeNpm('x'))).rejects.toThrow(
      'Versão inválida',
    )
    await expect(installManagedCli('muse', 'latest', true, fakeNpm('x'))).rejects.toThrow('npm')
    await expect(
      installManagedCli('codex', 'latest', true, async () => {
        throw Object.assign(new Error('x'), { code: 'ENOENT' })
      }),
    ).rejects.toThrow('npm não encontrado')
  })

  it('canal de update do Grok lê o JSON do próprio CLI', () => {
    const parse = SELF_UPDATE.grok?.check?.parse
    expect(parse?.('{"currentVersion":"1.0.70","latestVersion":"1.0.71"}')).toEqual({
      installed: '1.0.70',
      latest: '1.0.71',
    })
    expect(SELF_UPDATE.grok?.update).toEqual(['update'])
  })
})

describe('consentimento no primeiro uso', () => {
  it('a fila não executa nada até o aceite e retoma depois', async () => {
    const db = new OrchbotDatabase(':memory:', testSecretStorage)
    const agent = db.createAgent({
      name: 'A',
      workspacePath: os.tmpdir(),
      provider: 'codex',
      model: 'm',
    } as never)
    let runs = 0
    const registry = {
      getAdapter: () => ({
        id: 'codex',
        name: 'm',
        checkAvailability: async () => ({ available: true }),
        executeTurn: (_p: string, _o: unknown, cb: { onDone: (t: string) => void }) => {
          runs++
          setTimeout(() => cb.onDone('ok'), 5)
          return { interrupt() {} }
        },
      }),
      registerActiveExecution() {},
      removeActiveExecution() {},
      interruptThread: () => true,
    }
    let ok = false
    const queue = new QueueManager(db, registry as never)
    queue.setConsentCheck(() => ok)
    const task = queue.enqueue(agent.id, db.listThreads(agent.id)[0].id, 'oi')
    await new Promise((r) => setTimeout(r, 120))
    expect(runs).toBe(0)
    expect(db.getTask(task.id)?.status).toBe('pending')
    ok = true
    queue.kick()
    await new Promise((r) => setTimeout(r, 200))
    expect(db.getTask(task.id)?.status).toBe('completed')
    queue.close()
  })
})
