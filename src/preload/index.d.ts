import type { OrchbotApi } from '../shared/types'

declare global {
  interface Window {
    orchbot: OrchbotApi
  }
}
