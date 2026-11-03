import { execFile, execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const SERVER = 'agy_acp_server.par'

function executable(p: string): boolean {
  try {
    fs.accessSync(p, fs.constants.X_OK)
    return fs.statSync(p).isFile()
  } catch {
    return false
  }
}

const versionKey = (v: string) => v.split(/[.-]/).map((n) => Number.parseInt(n, 10) || 0)
function newestFirst(dirs: string[]): string[] {
  return [...dirs].sort((a, b) => {
    const [x, y] = [versionKey(a), versionKey(b)]
    for (let i = 0; i < Math.max(x.length, y.length); i++)
      if ((x[i] ?? 0) !== (y[i] ?? 0)) return (y[i] ?? 0) - (x[i] ?? 0)
    return 0
  })
}

/**
 * O Antigravity conversa por ACP com `agy_acp_server`, um binário à parte. Os comandos `antigravity`
 * (o IDE gráfico) e `agy` (CLI interativa) NÃO são esse servidor e nunca são procurados no PATH.
 * Ordem: caminho explícito → ORCHBOT_ANTIGRAVITY_PATH → wrapper do usuário → versões em
 * ~/.local/share/antigravity-acp → runtime gerenciado do OpenBot (somente leitura).
 * shortcut: só os caminhos do Linux; em macOS/Windows use o caminho explícito ou a variável de ambiente.
 */
export function resolveAntigravityServer(
  explicit?: string,
  home = os.homedir(),
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const named = explicit?.trim()
  if (named && !['antigravity', 'agy'].includes(path.basename(named))) return named
  const fromEnv = env.ORCHBOT_ANTIGRAVITY_PATH?.trim()
  if (fromEnv && executable(fromEnv)) return fromEnv

  const share = path.join(home, '.local', 'share', 'antigravity-acp')
  const wrapper = path.join(share, 'wrapper', SERVER)
  if (executable(wrapper)) return wrapper
  for (const v of newestFirst(safeDirs(share).filter((d) => d !== 'wrapper'))) {
    const candidate = path.join(share, v, SERVER)
    if (executable(candidate)) return candidate
  }

  const runtimes = path.join(home, '.config', 'OpenBot', 'provider-runtimes', 'antigravity')
  for (const platform of safeDirs(runtimes).filter((d) => d.startsWith(process.platform)))
    for (const v of newestFirst(safeDirs(path.join(runtimes, platform)))) {
      const candidate = path.join(runtimes, platform, v, 'bin', SERVER)
      if (executable(candidate)) return candidate
    }
  return undefined
}

function safeDirs(dir: string): string[] {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
  } catch {
    return []
  }
}

/**
 * Se o Orchbot foi aberto por um app que repassa RLIMIT_RTTIME limitado (T3 Code, por exemplo), o servidor
 * se mata com SIGKILL logo ao iniciar. Um limite herdado não pode ser aumentado por um filho comum.
 */
export function rttimeLimited(limits?: string): boolean {
  if (process.platform !== 'linux') return false
  try {
    const text = limits ?? fs.readFileSync('/proc/self/limits', 'utf8')
    const hard = text.match(/Max realtime timeout\s+(\S+)\s+(\S+)/)?.[2]
    return hard !== undefined && hard !== 'unlimited'
  } catch {
    return false
  }
}

const PASS_ENV = [
  'GEMINI_HOME',
  'AGY_ACP_FORCE_FILE_STORAGE',
  'TMPDIR',
  'BROWSER',
  'ANTIGRAVITY_HARNESS_PATH',
  'PYTHONUNBUFFERED',
  'SSL_CERT_FILE',
  'GEMINI_API_KEY',
  'GOOGLE_API_KEY',
  'ANTIGRAVITY_API_KEY',
  'PATH',
  'HOME',
  'XDG_RUNTIME_DIR',
  'DISPLAY',
  'WAYLAND_DISPLAY',
]
const runningUnits = new Set<string>()
process.once('exit', () => {
  for (const unit of runningUnits)
    try {
      execFileSync('systemctl', ['--user', 'stop', unit], { timeout: 3000, stdio: 'ignore' })
    } catch {
      // a unidade já terminou
    }
})

export interface Launch {
  command: string
  args: string[]
  /** Para o processo de verdade (encerrar o cliente do systemd-run NÃO para o serviço). */
  cleanup?: () => void
}

/**
 * Lança o servidor. Com limite de RTTIME restritivo, vai por `systemd-run --user` com LimitRTTIME=infinity.
 * Scripts (o wrapper do usuário) já cuidam disso sozinhos e rodam direto.
 */
export function guardedLaunch(
  command: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv = process.env,
  limited = rttimeLimited(),
): Launch {
  const isScript = (() => {
    try {
      const fd = fs.openSync(command, 'r')
      const head = Buffer.alloc(2)
      fs.readSync(fd, head, 0, 2, 0)
      fs.closeSync(fd)
      return head.toString() === '#!'
    } catch {
      return false
    }
  })()
  if (!limited || isScript || env.ORCHBOT_NO_RTTIME_GUARD) return { command, args }
  const unit = `orchbot-agy-${randomBytes(4).toString('hex')}`
  runningUnits.add(unit)
  return {
    command: 'systemd-run',
    args: [
      '--user',
      '--pipe',
      '--wait',
      '--collect',
      '--quiet',
      `--unit=${unit}`,
      '--service-type=exec',
      '--expand-environment=no',
      '-p',
      'LimitRTTIME=infinity',
      '-p',
      `WorkingDirectory=${cwd}`,
      ...PASS_ENV.filter((n) => env[n] !== undefined).flatMap((n) => ['-E', n]),
      command,
      ...args,
    ],
    cleanup: () => {
      execFile('systemctl', ['--user', 'stop', unit], { timeout: 5000 }, () =>
        runningUnits.delete(unit),
      )
    },
  }
}
