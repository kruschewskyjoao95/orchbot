import type { ProviderEffort, ProviderModelInfo } from './types'

const LABELS: Record<ProviderEffort, string> = {
  none: 'Sem raciocínio',
  minimal: 'Mínimo',
  low: 'Baixo',
  medium: 'Médio',
  high: 'Alto',
  xhigh: 'Muito alto',
  max: 'Máximo',
  ultra: 'Ultra',
}

export function modelEffortOptions(
  model: string,
  catalog?: ProviderModelInfo[],
): [ProviderEffort | '', string][] {
  const info = catalog?.find((item) => item.id === model)
  const efforts = info?.supportedEfforts ?? ['low', 'medium', 'high', 'xhigh', 'max']
  return [
    ['', 'Padrão'],
    ...efforts.map((value): [ProviderEffort, string] => [
      value,
      LABELS[value] ? `${LABELS[value]} (${value})` : value,
    ]),
  ]
}
