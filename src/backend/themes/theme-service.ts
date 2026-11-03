import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { ThemeFileInfo } from '../../shared/types'

const VAR_RE = /^--[a-z0-9-]{1,40}$/
// Cores, rgba(), sombras: só caracteres de valores CSS comuns; sem url(), ;, { } ou comentários.
const VALUE_RE = /^[#a-zA-Z0-9(),.%\s/-]{1,160}$/
const MAX_FILE = 32 * 1024

export type ThemeColors = Record<string, string>

const hex = (v: unknown) =>
  typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v) ? v.toLowerCase() : undefined
function mix(a: string, b: string, t: number): string {
  const p = (h: string, i: number) => Number.parseInt(h.slice(1 + i * 2, 3 + i * 2), 16)
  const c = [0, 1, 2].map((i) => Math.round(p(a, i) * (1 - t) + p(b, i) * t))
  return `#${c.map((x) => x.toString(16).padStart(2, '0')).join('')}`
}
const rgba = (h: string, a: number) =>
  `rgba(${[0, 1, 2].map((i) => Number.parseInt(h.slice(1 + i * 2, 3 + i * 2), 16)).join(', ')}, ${a})`

/** Paleta no formato do Omarchy (colors.toml) → variáveis CSS do Orchbot. */
export function varsFromPalette(c: ThemeColors, mode: 'dark' | 'light'): Record<string, string> {
  const bg = hex(c.background) ?? (mode === 'dark' ? '#161618' : '#f4f4f5')
  const fg = hex(c.foreground) ?? (mode === 'dark' ? '#d8d8dc' : '#202024')
  const accent = hex(c.accent) ?? '#6ea8fe'
  const dark = hex(c.dark_background) ?? mix(bg, '#000000', 0.2)
  const darker = hex(c.darker_background) ?? mix(bg, '#000000', 0.35)
  const lighter = hex(c.lighter_background) ?? mix(bg, fg, 0.1)
  const bright = hex(c.bright_foreground) ?? fg
  const muted = hex(c.dark_foreground) ?? mix(bg, fg, 0.5)
  const red = hex(c.red) ?? '#f87171'
  const green = hex(c.green) ?? '#34d399'
  const yellow = hex(c.yellow) ?? '#fbbf24'
  return {
    '--bg-main': bg,
    '--bg-sidebar': dark,
    '--bg-elevated': lighter,
    '--bg-card': lighter,
    '--bg-card-hover': hex(c.selection) ?? mix(lighter, fg, 0.08),
    '--bg-input': darker,
    '--border': mix(bg, fg, 0.18),
    '--border-strong': mix(bg, fg, 0.3),
    '--border-subtle': mix(bg, fg, 0.1),
    '--text-main': bright,
    '--text-secondary': fg,
    '--text-muted': muted,
    '--primary': bright,
    '--primary-fg': bg,
    '--primary-hover': mix(bright, mode === 'dark' ? '#ffffff' : '#000000', 0.2),
    '--accent': accent,
    '--accent-dim': rgba(accent, 0.16),
    '--accent-codex': green,
    '--accent-claude': yellow,
    '--accent-grok': hex(c.magenta) ?? '#f472b6',
    '--accent-gemini': hex(c.cyan) ?? hex(c.blue) ?? '#38bdf8',
    '--accent-muse': hex(c.bright_magenta) ?? hex(c.magenta) ?? '#a78bfa',
    '--danger': red,
    '--danger-bg': rgba(red, 0.1),
    '--success': green,
    '--warning': yellow,
  }
}

/** Mini-parser de TOML plano (`chave = "valor"`), suficiente para o colors.toml do Omarchy. */
export function parsePlainToml(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of text.split('\n')) {
    // Valor entre aspas pode conter "#" (cores); sem aspas, "#" começa um comentário.
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^#\n]*?))\s*(?:#.*)?$/)
    if (m) out[m[1]] = m[2] ?? m[3] ?? m[4] ?? ''
  }
  return out
}

function safeVars(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {}
  if (raw && typeof raw === 'object')
    for (const [k, v] of Object.entries(raw))
      if (VAR_RE.test(k) && typeof v === 'string' && VALUE_RE.test(v)) out[k] = v.trim()
  return out
}

/** Arquivo JSON: { name, mode, colors?: paleta, vars?: { "--bg-main": "#..." } } (vars vence colors). */
export function parseThemeJson(text: string, fileName: string): ThemeFileInfo {
  if (text.length > MAX_FILE) throw new Error('arquivo grande demais')
  const data = JSON.parse(text) as {
    name?: unknown
    mode?: unknown
    colors?: unknown
    vars?: unknown
  }
  const mode = data.mode === 'light' ? 'light' : 'dark'
  const palette: ThemeColors = {}
  if (data.colors && typeof data.colors === 'object')
    for (const [k, v] of Object.entries(data.colors)) if (typeof v === 'string') palette[k] = v
  const vars = {
    ...(Object.keys(palette).length ? varsFromPalette(palette, mode) : {}),
    ...safeVars(data.vars),
  }
  if (Object.keys(vars).length === 0) throw new Error('tema sem "colors" nem "vars"')
  return {
    id: fileName,
    name:
      typeof data.name === 'string' && data.name.trim()
        ? data.name.trim().slice(0, 60)
        : fileName.replace(/\.json$/, ''),
    mode,
    source: 'file',
    vars,
  }
}

export function omarchyThemesDir(home = os.homedir()): string {
  return path.join(home, '.config', 'omarchy', 'themes')
}

/** Lê os temas do usuário e os do Omarchy; arquivos inválidos são ignorados. */
export function loadThemes(userDir: string, omarchyDir = omarchyThemesDir()): ThemeFileInfo[] {
  const themes: ThemeFileInfo[] = []
  if (fs.existsSync(userDir))
    for (const f of fs
      .readdirSync(userDir)
      .filter((n) => n.endsWith('.json'))
      .sort()) {
      try {
        themes.push(parseThemeJson(fs.readFileSync(path.join(userDir, f), 'utf8'), f))
      } catch {
        // tema quebrado: ignora para não derrubar a lista
      }
    }
  if (fs.existsSync(omarchyDir))
    for (const d of fs
      .readdirSync(omarchyDir, { withFileTypes: true })
      .filter((e) => e.isDirectory() || e.isSymbolicLink())) {
      const file = path.join(omarchyDir, d.name, 'colors.toml')
      try {
        const toml = parsePlainToml(fs.readFileSync(file, 'utf8'))
        const mode = toml.mode === 'light' ? 'light' : 'dark'
        themes.push({
          id: `omarchy:${d.name}`,
          name: `Omarchy · ${d.name}`,
          mode,
          source: 'omarchy',
          vars: varsFromPalette(toml, mode),
        })
      } catch {
        // sem colors.toml
      }
    }
  return themes
}

/** Observa as pastas de tema e avisa (com debounce) a cada mudança. Devolve a função de parada. */
export function watchThemes(dirs: string[], onChange: () => void): () => void {
  let timer: NodeJS.Timeout | undefined
  const watchers: fs.FSWatcher[] = []
  const fire = () => {
    clearTimeout(timer)
    timer = setTimeout(onChange, 150)
  }
  // No Linux fs.watch não é recursivo: observa também cada subpasta (colors.toml do Omarchy fica nelas).
  const targets = dirs.flatMap((dir) => {
    if (process.platform !== 'linux') return [dir]
    try {
      return [
        dir,
        ...fs
          .readdirSync(dir, { withFileTypes: true })
          .filter((e) => e.isDirectory() || e.isSymbolicLink())
          .map((e) => path.join(dir, e.name)),
      ]
    } catch {
      return [dir]
    }
  })
  for (const dir of targets) {
    try {
      watchers.push(fs.watch(dir, { recursive: process.platform !== 'linux' }, fire))
    } catch {
      // pasta inexistente (ex.: sem Omarchy) ou sem permissão
    }
  }
  return () => {
    clearTimeout(timer)
    for (const w of watchers) w.close()
  }
}

export const EXAMPLE_THEME = JSON.stringify(
  {
    name: 'Exemplo',
    mode: 'dark',
    colors: { background: '#151718', foreground: '#d8d0b8', accent: '#e36b2c' },
    vars: { '--accent-dim': 'rgba(227, 107, 44, 0.2)' },
  },
  null,
  2,
)
