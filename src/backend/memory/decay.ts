import type { MemoryKind } from '../../shared/types'

/** Preferência dura meses; tarefa dura dias. 1 = recém-usada, perto de 0 = esquecida na busca. */
const HALF_LIFE_DAYS: Record<MemoryKind, number> = {
  preference: 90,
  task: 7,
}

export function memoryFreshness(kind: MemoryKind, touchedAt: string, now = Date.now()): number {
  const touched = Date.parse(touchedAt)
  if (!Number.isFinite(touched)) return 0
  const ageDays = Math.max(0, now - touched) / 86_400_000
  return 0.5 ** (ageDays / HALF_LIFE_DAYS[kind])
}
