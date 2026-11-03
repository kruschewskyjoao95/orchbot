import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/** Aspas da especificação Desktop Entry: o caminho do AppImage pode ter espaços. */
const quote = (p: string) => `"${p.replace(/(["`$\\])/g, '\\$1')}"`

export function desktopEntry(exec: string, icon: string, autostart = false): string {
  return [
    '[Desktop Entry]',
    'Type=Application',
    'Name=Orchbot',
    `Exec=${quote(exec)}${autostart ? '' : ' %U'}`,
    `Icon=${icon}`,
    'Terminal=false',
    'Categories=Development;',
    ...(autostart ? [] : ['MimeType=x-scheme-handler/orchbot;']),
    '',
  ].join('\n')
}

/** Electron não implementa openAtLogin no Linux: o padrão XDG é um .desktop em ~/.config/autostart. */
export function setLinuxAutostart(
  enabled: boolean,
  exec: string,
  icon: string,
  home = os.homedir(),
) {
  const file = path.join(home, '.config', 'autostart', 'orchbot.desktop')
  if (!enabled) return fs.rmSync(file, { force: true })
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, desktopEntry(exec, icon, true))
}

/**
 * O AppImage não instala .desktop: sem ele, nem o link orchbot:// nem o ícone do lançador funcionam.
 * Reescreve a cada início porque o AppImage pode ter mudado de pasta.
 */
export function registerAppImageDesktop(
  appImage: string,
  iconSource: string,
  home = os.homedir(),
  setDefaultHandler = true,
) {
  const share = path.join(home, '.local', 'share')
  const icon = path.join(share, 'icons', 'orchbot.png')
  fs.mkdirSync(path.dirname(icon), { recursive: true })
  fs.copyFileSync(iconSource, icon)
  const file = path.join(share, 'applications', 'orchbot.desktop')
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, desktopEntry(appImage, icon))
  if (setDefaultHandler)
    execFile('xdg-mime', ['default', 'orchbot.desktop', 'x-scheme-handler/orchbot'], () => {})
  return icon
}
