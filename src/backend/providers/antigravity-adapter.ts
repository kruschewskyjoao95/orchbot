import { AcpAdapter, type AcpFlavor } from './acp-adapter'
import { resolveAntigravityServer } from './antigravity-server'

/**
 * O Antigravity fala ACP por stdio com o `agy_acp_server` (nada de `agy` nem do IDE `antigravity`).
 * clientInfo "zed": é o nome de cliente que o servidor reconhece para liberar os modelos Claude/GPT
 * (mesma convenção usada por projetos de referência, ver docs/research-providers-openbot-paseo.md).
 */
export const ANTIGRAVITY_FLAVOR: AcpFlavor = {
  id: 'antigravity',
  name: 'Antigravity (Google)',
  clientName: 'zed',
  installHint:
    'Instale o servidor ACP do Antigravity (agy_acp_server) ou informe o caminho em ⚙ ou em ORCHBOT_ANTIGRAVITY_PATH. Os comandos `antigravity` (IDE) e `agy` (CLI) não servem.',
  loginHint:
    'Entre com sua conta Google no Antigravity: o servidor ACP usa a sessão salva em ~/.gemini/antigravity-acp.',
  missingMessage:
    'Servidor ACP do Antigravity (agy_acp_server) não encontrado. Informe o caminho em ⚙ ou em ORCHBOT_ANTIGRAVITY_PATH.',
  guardRttime: true,
  launch: (config) => {
    const command = resolveAntigravityServer(config?.cliPath)
    return command ? { command, args: config?.cliArgs ?? [] } : undefined
  },
}

export class AntigravityAdapter extends AcpAdapter {
  constructor() {
    super(ANTIGRAVITY_FLAVOR)
  }
}
