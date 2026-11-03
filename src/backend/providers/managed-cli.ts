import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import type { ManagedCliInfo, SupportedProvider } from '../../shared/types'
import { SELF_UPDATE } from '../updates/self-update'
import { NPM_PACKAGES } from '../updates/update-checker'
import { getCatalogEntry } from './catalog'

const execFileAsync = promisify(execFile)
const VERSION_RE = /^(latest|\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?)$/

let root = ''
/** Pasta onde o app instala CLIs (dentro do userData; sem sudo e sem tocar no npm global). */
export function setManagedCliRoot(dir: string): void {
  root = dir
}

const dirOf = (id: SupportedProvider) => path.join(root, id)
const stateFile = (id: SupportedProvider) => path.join(dirOf(id), 'state.json')

function readState(id: SupportedProvider): { version?: string; pinned: boolean } {
  try {
    return JSON.parse(fs.readFileSync(stateFile(id), 'utf8'))
  } catch {
    return { pinned: false }
  }
}

/** Binário instalado pelo app para este provedor, se existir. */
export function managedBinPath(id: SupportedProvider): string | undefined {
  if (!root) return undefined
  const command = getCatalogEntry(id)?.cliCommand
  if (!command) return undefined
  const bin = path.join(dirOf(id), 'node_modules', '.bin', command)
  return fs.existsSync(bin) ? bin : undefined
}

export function getManagedInfo(id: SupportedProvider): ManagedCliInfo {
  const bin = managedBinPath(id)
  const state = readState(id)
  return {
    providerId: id,
    installed: Boolean(bin),
    version: bin ? state.version : undefined,
    pinned: Boolean(bin) && state.pinned,
    binPath: bin,
    npmPackage: NPM_PACKAGES[id],
    selfUpdate: Boolean(SELF_UPDATE[id]),
  }
}

export function listManagedClis(ids: SupportedProvider[]): ManagedCliInfo[] {
  return ids.map(getManagedInfo)
}

export function isPinned(id: SupportedProvider): boolean {
  return getManagedInfo(id).pinned
}

type Runner = (cmd: string, args: string[]) => Promise<unknown>
const defaultRunner: Runner = (cmd, args) =>
  execFileAsync(cmd, args, { timeout: 10 * 60_000, maxBuffer: 8 * 1024 * 1024 })

/**
 * Instala o CLI numa pasta própria: `npm install --prefix <pasta> <pacote>@<versão>`.
 * Com `pin`, o app deixa de oferecer/aplicar atualizações até o usuário soltar a versão.
 */
export async function installManagedCli(
  id: SupportedProvider,
  version = 'latest',
  pin = true,
  run: Runner = defaultRunner,
): Promise<ManagedCliInfo> {
  const pkg = NPM_PACKAGES[id]
  if (!root) throw new Error('Instalação gerenciada indisponível.')
  if (!pkg) throw new Error('Este CLI não é distribuído pelo npm; o app não consegue instalá-lo.')
  if (!VERSION_RE.test(version)) throw new Error('Versão inválida (use 1.2.3 ou "latest").')
  fs.mkdirSync(dirOf(id), { recursive: true })
  const manifest = path.join(dirOf(id), 'package.json')
  if (!fs.existsSync(manifest)) fs.writeFileSync(manifest, '{"private":true}')
  try {
    await run('npm', [
      'install',
      '--prefix',
      dirOf(id),
      '--no-audit',
      '--no-fund',
      `${pkg}@${version}`,
    ])
  } catch (err) {
    const e = err as { code?: string; stderr?: string; message?: string }
    throw new Error(
      e.code === 'ENOENT'
        ? 'npm não encontrado. Instale o Node.js para o app instalar CLIs.'
        : `Falha ao instalar ${pkg}@${version}: ${(e.stderr || e.message || '').slice(-400)}`,
    )
  }
  let installed = version
  try {
    installed = JSON.parse(
      fs.readFileSync(
        path.join(dirOf(id), 'node_modules', ...pkg.split('/'), 'package.json'),
        'utf8',
      ),
    ).version
  } catch {
    // mantém o pedido quando o package.json não pôde ser lido
  }
  fs.writeFileSync(stateFile(id), JSON.stringify({ version: installed, pinned: pin }))
  return getManagedInfo(id)
}

export function setManagedPin(id: SupportedProvider, pinned: boolean): ManagedCliInfo {
  if (!managedBinPath(id)) throw new Error('O CLI não foi instalado pelo app.')
  fs.writeFileSync(stateFile(id), JSON.stringify({ ...readState(id), pinned }))
  return getManagedInfo(id)
}

export function removeManagedCli(id: SupportedProvider): ManagedCliInfo {
  if (root) fs.rmSync(dirOf(id), { recursive: true, force: true })
  return getManagedInfo(id)
}
