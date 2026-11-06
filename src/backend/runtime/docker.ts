import { execFile, execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import type { Agent } from '../../shared/types'
import type { ProviderRuntimeConfig } from '../providers/types'

const exec = promisify(execFile)
export const RUNTIME_IMAGE = 'orchbot-runtime:1'
export const BROWSER_MCP = {
  name: 'orchbot_browser',
  transport: 'stdio' as const,
  command: 'playwright-mcp',
  args: [
    '--headless',
    '--isolated',
    '--browser',
    'chrome',
    '--executable-path',
    '/usr/local/bin/orchbot-chromium',
    '--no-sandbox',
  ],
  env: {},
}
const managed = new Set<string>()
process.once('exit', () => {
  if (managed.size)
    try {
      execFileSync('docker', ['rm', '--force', ...managed], { timeout: 5000, stdio: 'ignore' })
    } catch {
      /* Docker ou host indisponível: a documentação explica a remoção por label. */
    }
})

export function validateDockerAgent(agent: Agent, config: ProviderRuntimeConfig): void {
  if (process.platform !== 'linux' || !process.getuid || process.getuid() === 0)
    throw new Error('O runtime Docker requer Linux e usuário sem privilégios.')
  if (
    !['codex', 'claude'].includes(agent.provider) ||
    agent.systemRole ||
    agent.role === 'orchestrator'
  )
    throw new Error('Docker suporta colegas Codex/Claude; coordenadores continuam no host.')
  if (!config.apiKey?.trim() || config.cliProfile || config.cliPath)
    throw new Error(
      'Docker requer uma conta com chave de API e CLI padrão; perfis de login do host não são montados.',
    )
  dockerWorkspace(agent.workspacePath)
}

export function dockerWorkspace(workspace: string): string {
  const real = fs.realpathSync(workspace)
  const home = os.homedir()
  if (
    !fs.statSync(real).isDirectory() ||
    !path.isAbsolute(workspace) ||
    /[,\n\r]/.test(real) ||
    real === '/' ||
    real === home ||
    home.startsWith(`${real}/`) ||
    real.startsWith(`${home}/.`) ||
    real.split('/').filter(Boolean).length < 2 ||
    path.resolve(workspace) !== real
  )
    throw new Error(
      'Escolha uma pasta de trabalho dedicada; raiz, home e pastas de credenciais não podem ser montadas.',
    )
  return real
}

export function dockerCreateArgs(
  name: string,
  workspace: string,
  env: NodeJS.ProcessEnv,
): string[] {
  return [
    'create',
    '--name',
    name,
    '--label',
    'org.orchbot.managed=1',
    '--init',
    '--interactive',
    '--read-only',
    '--cap-drop=ALL',
    '--security-opt=no-new-privileges',
    '--pids-limit=256',
    '--memory=2g',
    '--cpus=2',
    '--shm-size=256m',
    '--user',
    `${process.getuid?.()}:${process.getgid?.()}`,
    '--tmpfs',
    '/tmp:rw,nosuid,nodev,size=512m,mode=1777',
    '--env',
    'HOME=/tmp/orchbot-home',
    '--workdir',
    workspace,
    '--mount',
    `type=bind,source=${workspace},target=${workspace}`,
    ...Object.keys(env).flatMap((key) => ['--env', key]),
    RUNTIME_IMAGE,
  ]
}

export async function dockerStatus(): Promise<string> {
  try {
    if (process.platform !== 'linux' || process.arch !== 'x64')
      throw new Error('Runtime verificado somente em Linux amd64.')
    if (process.env.DOCKER_HOST && !process.env.DOCKER_HOST.startsWith('unix://'))
      throw new Error('Requer Docker local.')
    const context = await exec(
      'docker',
      ['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}'],
      { timeout: 8000 },
    )
    if (!context.stdout.trim().startsWith('unix://'))
      throw new Error('Requer daemon local por socket Unix.')
    const { stdout } = await exec(
      'docker',
      [
        'image',
        'inspect',
        '--format',
        '{{index .Config.Labels "org.orchbot.runtime"}}',
        RUNTIME_IMAGE,
      ],
      { timeout: 8000 },
    )
    if (stdout.trim() !== '1') throw new Error('Imagem sem identificação do Orchbot.')
    return `Docker acessível; imagem ${RUNTIME_IMAGE} disponível. Linux, kernel compartilhado; rede bridge com saída para internet/LAN.`
  } catch {
    throw new Error(
      `Docker indisponível ou imagem ausente. Compile resources/runtime/Dockerfile como ${RUNTIME_IMAGE}.`,
    )
  }
}

export function dockerEnv(config: ProviderRuntimeConfig): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  // Somente a conta escolhida e os MCP vinculados entram no container; nunca o ambiente inteiro do desktop.
  for (const key of config.envKeys ?? []) if (config.apiKey) env[key] = config.apiKey
  if (config.endpoint) {
    env.OPENAI_BASE_URL = config.endpoint
    env.ANTHROPIC_BASE_URL = config.endpoint
  }
  Object.assign(env, config.extraEnv)
  return env
}

export async function createDockerLaunch(
  command: string,
  args: string[],
  workspace: string,
  config: ProviderRuntimeConfig,
) {
  await dockerStatus()
  const real = dockerWorkspace(workspace)
  const name = `orchbot-${randomUUID()}`
  const env = dockerEnv(config)
  let removal: Promise<void> | undefined
  const cleanup = () => {
    removal ??= exec('docker', ['rm', '--force', name], { timeout: 10000 }).then(() => {
      managed.delete(name)
    })
    return removal
  }
  managed.add(name)
  try {
    await exec('docker', [...dockerCreateArgs(name, real, env), command, ...args], {
      env: { ...process.env, ...env },
      timeout: 30000,
      maxBuffer: 256 * 1024,
    })
  } catch (error) {
    await cleanup().catch(() => undefined)
    throw error
  }
  return { command: 'docker', args: ['start', '--attach', '--interactive', name], cleanup }
}
