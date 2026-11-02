/// <reference types="vite/client" />
import type { OrchbotApi } from '../../shared/types'

declare global {
  interface Window {
    orchbot: OrchbotApi
  }
}
