import type { ProviderInfo, ProviderReadiness } from './types'

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
