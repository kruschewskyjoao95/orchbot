import type { SupportedProvider } from '../../shared/types'

interface SelfUpdate {
  /** Argumentos que consultam a versão mais recente e imprimem JSON; ausente = só npm/registro. */
  check?: {
    args: string[]
    parse: (stdout: string) => { installed: string | null; latest: string | null }
  }
  /** Argumentos que atualizam o próprio CLI. */
  update: string[]
}

/** CLIs que se atualizam sozinhos. Só entram aqui comandos conferidos no CLI real. */
export const SELF_UPDATE: Partial<Record<SupportedProvider, SelfUpdate>> = {
  grok: {
    check: {
      args: ['update', '--check', '--json'],
      parse: (out) => {
        const j = JSON.parse(out) as { currentVersion?: string; latestVersion?: string }
        return { installed: j.currentVersion ?? null, latest: j.latestVersion ?? null }
      },
    },
    update: ['update'],
  },
  pi: { update: ['update', '--self'] },
}

/** Por que alguns CLIs não têm botão de atualizar. */
export const NO_UPDATE_CHANNEL: Partial<Record<SupportedProvider, string>> = {
  muse: 'O Muse não expõe um comando de atualização; reinstale pelo método original.',
  antigravity:
    'O servidor ACP do Antigravity é atualizado pelo app que o instalou (T3 Code, outros apps…).',
}
