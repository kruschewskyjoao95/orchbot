import { execFile, spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export interface ComputerUseStatus {
  ready: boolean
  partial: boolean
  platform: string
  sessionType: string
  screenshotTool: string | null
  windowTool: string | null
  inputTool: string | null
  missing: string[]
  message: string
}

async function which(cmd: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('which', [cmd])
    return stdout.trim().split('\n')[0] || null
  } catch {
    return null
  }
}

export async function checkComputerUse(): Promise<ComputerUseStatus> {
  const platform = process.platform
  const sessionType =
    process.env.XDG_SESSION_TYPE || (process.env.WAYLAND_DISPLAY ? 'wayland' : 'x11')

  const [grim, imp, wmctrl, hyprctl, wtype, xdotool] = await Promise.all([
    which('grim'),
    which('import'),
    which('wmctrl'),
    which('hyprctl'),
    which('wtype'),
    which('xdotool'),
  ])

  const screenshotTool = grim ? 'grim' : imp ? 'import' : null
  const windowTool = hyprctl ? 'hyprctl' : wmctrl ? 'wmctrl' : null
  const inputTool = wtype ? 'wtype' : xdotool ? 'xdotool' : null
  const missing: string[] = []
  if (!screenshotTool) missing.push('screenshot (grim ou ImageMagick import)')
  if (!windowTool) missing.push('janelas (hyprctl ou wmctrl)')
  if (!inputTool) missing.push('teclado (wtype ou xdotool)')

  const ready = Boolean(screenshotTool && windowTool)
  return {
    ready,
    partial: !ready && Boolean(screenshotTool || windowTool || inputTool),
    platform,
    sessionType,
    screenshotTool,
    windowTool,
    inputTool,
    missing,
    message: ready
      ? 'O Orchbot pode ver e interagir com aplicativos neste computador. Este sistema não pede nenhuma permissão adicional.'
      : `Uso do computador incompleto: falta ${missing.join(', ')}.`,
  }
}

export interface ComputerActionResult {
  action: string
  summary: string
}

export async function listApps(status: ComputerUseStatus): Promise<ComputerActionResult> {
  if (status.windowTool === 'hyprctl') {
    const { stdout } = await execFileAsync('hyprctl', ['clients', '-j'], { timeout: 8000 })
    const clients = JSON.parse(stdout) as Array<{
      class?: string
      title?: string
      at?: number[]
      size?: number[]
    }>
    const lines = clients
      .filter((c) => c.class || c.title)
      .slice(0, 20)
      .map(
        (c) =>
          `- ${c.class ?? 'app'}: "${(c.title ?? '').slice(0, 80)}" em ${c.at?.join(',') ?? '?'} tamanho ${c.size?.join('x') ?? '?'}`,
      )
    return { action: 'apps', summary: lines.length ? lines.join('\n') : 'Nenhuma janela aberta.' }
  }
  if (status.windowTool === 'wmctrl') {
    const { stdout } = await execFileAsync('wmctrl', ['-l'], { timeout: 8000 })
    return { action: 'apps', summary: stdout.trim().slice(0, 1500) || 'Nenhuma janela aberta.' }
  }
  return { action: 'apps', summary: 'Listagem de janelas indisponível nesta sessão.' }
}

export async function takeScreenshot(
  outDir: string,
  status: ComputerUseStatus,
): Promise<ComputerActionResult & { filePath?: string }> {
  fs.mkdirSync(outDir, { recursive: true })
  const filePath = path.join(outDir, `screenshot-${Date.now()}.png`)
  if (status.screenshotTool === 'grim') {
    await execFileAsync('grim', [filePath], { timeout: 15000 })
  } else if (status.screenshotTool === 'import') {
    await execFileAsync('import', ['-window', 'root', filePath], { timeout: 15000 })
  } else {
    throw new Error('Nenhuma ferramenta de screenshot (grim/import) disponível.')
  }
  return {
    action: 'screenshot',
    filePath,
    summary: `Screenshot salva em ${filePath}. Use a lista de apps e as coordenadas das janelas para agir; o texto das janelas vem de apps/inspect do navegador quando aplicável.`,
  }
}

export async function executeComputerAction(
  action: string,
  args: Record<string, unknown>,
  outDir: string,
): Promise<ComputerActionResult & { filePath?: string }> {
  const status = await checkComputerUse()
  switch (action) {
    case 'screenshot':
      return takeScreenshot(outDir, status)
    case 'apps':
      return listApps(status)
    case 'open': {
      const app = String(args.app ?? args.target ?? '').trim()
      if (!app) throw new Error('Informe o aplicativo/comando para abrir.')
      const child = spawn(app, [], { shell: true, detached: true, stdio: 'ignore' })
      child.unref()
      return {
        action,
        summary: `Aplicativo iniciado: ${app}. Aguarde e tire um screenshot para confirmar.`,
      }
    }
    case 'click': {
      const x = Number(args.x)
      const y = Number(args.y)
      if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error('Coordenadas x/y inválidas.')
      if (status.windowTool === 'hyprctl') {
        await execFileAsync('hyprctl', ['dispatch', 'movecursor', String(x), String(y)], {
          timeout: 8000,
        })
        await execFileAsync('hyprctl', ['dispatch', 'mouse', '272'], { timeout: 8000 }).catch(
          () => {},
        )
        return { action, summary: `Clique tentado em ${x},${y} (Hyprland).` }
      }
      if (status.inputTool === 'xdotool') {
        await execFileAsync('xdotool', ['mousemove', String(x), String(y), 'click', '1'], {
          timeout: 8000,
        })
        return { action, summary: `Clique em ${x},${y}.` }
      }
      throw new Error('Clique indisponível nesta sessão (sem hyprctl/xdotool).')
    }
    case 'type': {
      const text = String(args.text ?? args.value ?? '')
      if (!text) throw new Error('Texto vazio para digitar.')
      if (status.inputTool === 'wtype') {
        await execFileAsync('wtype', [text.slice(0, 500)], { timeout: 8000 })
        return { action, summary: `Texto digitado (${text.length} caracteres).` }
      }
      if (status.inputTool === 'xdotool') {
        await execFileAsync('xdotool', ['type', '--', text.slice(0, 500)], { timeout: 8000 })
        return { action, summary: `Texto digitado (${text.length} caracteres).` }
      }
      throw new Error('Digitação indisponível nesta sessão (sem wtype/xdotool).')
    }
    case 'key': {
      const key = String(args.key ?? args.target ?? '').trim()
      if (!key) throw new Error('Informe a tecla (ex.: Return, Tab, ctrl+s).')
      if (status.inputTool === 'wtype') {
        await execFileAsync('wtype', ['-k', key], { timeout: 8000 })
        return { action, summary: `Tecla enviada: ${key}.` }
      }
      if (status.inputTool === 'xdotool') {
        await execFileAsync('xdotool', ['key', key], { timeout: 8000 })
        return { action, summary: `Tecla enviada: ${key}.` }
      }
      throw new Error('Teclas indisponíveis nesta sessão.')
    }
    default:
      throw new Error(`Ação de computador desconhecida: ${action}`)
  }
}
