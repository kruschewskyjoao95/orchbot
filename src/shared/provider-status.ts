import type { ProviderConnection, ProviderInfo, ProviderReadiness } from './types'

export const PROVIDER_READINESS_LABELS: Record<ProviderReadiness, string> = {
  ready: 'Pronto',
  login_required: 'Precisa entrar',
  not_installed: 'Não instalado',
  unverified: 'Login não verificado',
  not_configured: 'Precisa configurar',
  error: 'Falha na checagem',
}
export function providerStatusLabel(info: Pick<ProviderInfo, 'readiness'>): string {
  return PROVIDER_READINESS_LABELS[info.readiness ?? 'unverified']
}

/** Conexão usada por padrão em novos agentes: a principal se ativa, senão a primeira pronta, senão a primeira ativa. */
export function principalConnection<
  T extends Pick<ProviderConnection, 'providerId' | 'enabled' | 'readiness'>,
>(connections: T[], defaultProvider: string): T | undefined {
  const enabled = connections.filter((c) => c.enabled)
  return (
    enabled.find((c) => c.providerId === defaultProvider) ??
    enabled.find((c) => c.readiness === 'ready') ??
    enabled[0]
  )
}
