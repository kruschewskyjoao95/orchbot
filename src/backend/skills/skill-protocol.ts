export type SkillAction = 'list' | 'load' | 'create' | 'revise' | 'install'

export interface SkillDirective {
  action: SkillAction
  /** slug / caminho (antes de "::"). */
  target: string
  /** create/revise: primeira linha = descrição, resto = instruções da skill. */
  body: string
}

const BLOCK_RE = /\[\[SKILL:([a-z]+)\]\]([\s\S]*?)\[\[\/SKILL\]\]/gi
const ACTIONS: SkillAction[] = ['list', 'load', 'create', 'revise', 'install']

export function parseSkillDirectives(text: string): SkillDirective[] {
  const out: SkillDirective[] = []
  for (const m of text.matchAll(BLOCK_RE)) {
    const action = m[1].toLowerCase() as SkillAction
    if (!ACTIONS.includes(action)) continue
    const raw = m[2].trim()
    if (action === 'create' || action === 'revise') {
      const i = raw.indexOf('::')
      const target = i < 0 ? '' : raw.slice(0, i).trim()
      const body = i < 0 ? '' : raw.slice(i + 2).trim()
      if (target && body) out.push({ action, target, body })
    } else if (action === 'list') out.push({ action, target: '', body: '' })
    else if (raw) out.push({ action, target: raw, body: '' })
  }
  return out
}

export const stripSkillDirectives = (text: string) => text.replace(BLOCK_RE, '').trim()

/** list e load devolvem conteúdo ao modelo; o resto é só confirmação. */
export const needsSkillFollowUp = (d: SkillDirective[]) =>
  d.some((x) => x.action === 'list' || x.action === 'load')

export function buildSkillInstructions(skills: { slug: string; description: string }[]): string {
  return [
    '[SKILLS]',
    skills.length
      ? `Skills ativas para você (use [[SKILL:load]] para ler as instruções completas antes de aplicar):\n${skills.map((s) => `- ${s.slug}: ${s.description}`).join('\n')}`
      : 'Você ainda não tem skills ativas.',
    'Blocos disponíveis ao final da resposta:',
    '[[SKILL:list]] [[/SKILL]]',
    '[[SKILL:load]] slug [[/SKILL]]',
    '[[SKILL:create]] slug :: descrição de uma linha, e nas linhas seguintes as instruções em markdown [[/SKILL]]  (abre uma proposta; a skill só existe depois que a pessoa aceitar)',
    '[[SKILL:revise]] slug :: nova descrição na 1ª linha, depois as novas instruções completas [[/SKILL]]  (versão anterior fica no histórico)',
    '[[SKILL:install]] pasta/dentro/do/workspace [[/SKILL]]  (instala uma pasta com SKILL.md)',
    'Crie skills só para procedimentos que se repetem; nunca coloque senhas ou segredos nelas.',
  ].join('\n')
}
