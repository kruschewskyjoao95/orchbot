import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import type { ContextMode } from '../../shared/types'
import { redactSecrets } from '../browser/sanitizer'

const execFileAsync = promisify(execFile)

type Run = (args: string[], cwd: string) => Promise<string>

// Um repositório pode trazer config hostil: core.fsmonitor executa um comando em `git status`, e
// diff.<driver>.textconv/external executam programas em `git diff`. Desligamos tudo isso.
const SAFE = [
  '-c',
  'core.fsmonitor=false',
  '-c',
  'core.pager=cat',
  '-c',
  'diff.external=',
  '--no-optional-locks',
]

const run: Run = async (args, cwd) => {
  const { stdout } = await execFileAsync('git', [...SAFE, ...args], {
    cwd,
    timeout: 3000,
    maxBuffer: 1024 * 1024,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0', GIT_PAGER: 'cat' },
  })
  return stdout
}

const LIMITS: Record<
  ContextMode,
  { status: number; commits: number; stat: number; diffChars: number; total: number }
> = {
  economico: { status: 15, commits: 0, stat: 0, diffChars: 0, total: 1500 },
  padrao: { status: 30, commits: 5, stat: 20, diffChars: 0, total: 4000 },
  completo: { status: 60, commits: 10, stat: 40, diffChars: 6000, total: 10000 },
}

const lines = (text: string, max: number) => {
  const all = text.split('\n').filter((l) => l.trim())
  return all.length > max ? [...all.slice(0, max), `… (+${all.length - max} linhas)`] : all
}

/**
 * `filter.<driver>.clean/smudge/process` roda um programa em status e diff, e não há opção do git que
 * desligue todos: sobrescrevemos cada driver configurado com valor vazio (o git então não filtra).
 * Submódulos ficam de fora (`--ignore-submodules=all`) porque têm config própria.
 */
export function filterOverrides(configOutput: string): string[] {
  const drivers = new Set<string>()
  for (const line of configOutput.split('\n')) {
    // O nome do driver pode ter pontos: fica entre "filter." e o último ponto da chave.
    const key = line.split(/\s/, 1)[0]
    const last = key.lastIndexOf('.')
    if (key.toLowerCase().startsWith('filter.') && last > 'filter.'.length)
      drivers.add(key.slice('filter.'.length, last))
  }
  return [...drivers].flatMap((d) =>
    ['clean', 'smudge', 'process']
      .flatMap((k) => ['-c', `filter.${d}.${k}=`])
      .concat(['-c', `filter.${d}.required=false`]),
  )
}

/** `.git` (pasta ou arquivo de worktree) no workspace ou acima: evita abrir um processo fora de repositórios. */
function insideGitDir(start: string): boolean {
  let dir = path.resolve(start)
  for (;;) {
    if (fs.existsSync(path.join(dir, '.git'))) return true
    const parent = path.dirname(dir)
    if (parent === dir) return false
    dir = parent
  }
}

/**
 * Estado do repositório do workspace para o início do turno: branch, arquivos alterados, commits
 * recentes e, no modo completo, o diff. Só leitura. Devolve null fora de um repositório git.
 */
export async function buildGitContext(
  workspace: string,
  mode: ContextMode,
  git: Run = run,
): Promise<string | null> {
  const limit = LIMITS[mode]
  if (git === run && !insideGitDir(workspace)) return null
  try {
    if ((await git(['rev-parse', '--is-inside-work-tree'], workspace)).trim() !== 'true')
      return null
  } catch {
    return null
  }
  // Ler a config não executa nada; com ela, anulamos cada filtro antes de status/diff.
  const noFilters = filterOverrides(
    await git(['config', '--get-regexp', '^filter\\.'], workspace).catch(() => ''),
  )
  const attempt = (args: string[]) => git([...noFilters, ...args], workspace).catch(() => '')
  const [branch, head, status, commits, stat, diff] = await Promise.all([
    attempt(['branch', '--show-current']),
    attempt(['rev-parse', '--short', 'HEAD']),
    attempt(['status', '--short', '-unormal', '--ignore-submodules=all']),
    limit.commits
      ? attempt(['log', '-n', String(limit.commits), '--pretty=format:%h %s (%cr)'])
      : '',
    limit.stat
      ? attempt([
          'diff',
          'HEAD',
          '--stat',
          '--no-ext-diff',
          '--no-textconv',
          '--ignore-submodules=all',
        ])
      : '',
    limit.diffChars
      ? attempt([
          'diff',
          'HEAD',
          '-U2',
          '--no-ext-diff',
          '--no-textconv',
          '--ignore-submodules=all',
        ])
      : '',
  ])

  const parts = [
    '[CONTEXTO GIT — estado do repositório no início deste turno]',
    `Branch: ${branch.trim() || `(HEAD solto em ${head.trim() || '?'})`}`,
    status.trim()
      ? `Alterações:\n${lines(status, limit.status).join('\n')}`
      : 'Árvore de trabalho limpa.',
  ]
  if (commits.trim()) parts.push(`Commits recentes:\n${lines(commits, limit.commits).join('\n')}`)
  if (stat.trim()) parts.push(`Resumo do diff:\n${lines(stat, limit.stat).join('\n')}`)
  if (diff.trim()) {
    const cut =
      diff.length > limit.diffChars ? `${diff.slice(0, limit.diffChars)}\n… (diff truncado)` : diff
    parts.push(`Diff:\n${redactSecrets(cut)}`)
  }
  const text = parts.join('\n\n')
  return text.length > limit.total
    ? `${text.slice(0, limit.total)}\n… (contexto git truncado)`
    : text
}
