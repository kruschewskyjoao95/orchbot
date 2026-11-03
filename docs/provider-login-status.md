# Status de instalação e login

As conexões distinguem:

- **Pronto**: a checagem específica do CLI ou do protocolo confirmou o estado necessário para iniciar uma sessão.
- **Precisa entrar**: o CLI/protocolo informou falta de autenticação, ou não encontrou credenciais para o provedor selecionado.
- **Não instalado**: o executável não foi encontrado. Ter uma chave no ambiente não instala o CLI.
- **Login não verificado**: o programa/API responde, mas não oferece uma confirmação segura de autenticação nesta integração, ou a versão instalada não suporta a checagem.
- **Precisa configurar**: falta informar o comando do agente ACP.
- **Falha na checagem**: erro de instalação/configuração, modelo inválido, timeout ou outra falha que não comprova falta de login.

O status aparece na lista de conexões, no resumo lateral, na seleção dos robôs e no modal de configuração. **Testar conexão** atualiza o cartão com o resultado daquela verificação. Atualizar a lista refaz as checagens; o modo de conexão rápida pode reutilizar o resumo por até 60 segundos. O cadastro de uma conexão e a seleção manual de um provedor continuam possíveis mesmo sem confirmação automática.

## Checagens usadas

| Integração | Checagem sem gerar resposta |
| --- | --- |
| Codex | `codex login status`: sucesso confirma as credenciais locais; saída de falta de login é separada de erro de configuração. |
| Claude | `claude auth status --json`: verifica `loggedIn` e o código de saída, sem repassar os demais campos à tela. |
| Pi | `pi auth check --model <modelo padrão> --json`: interpreta `ready`, `not_ready` e `invalid`. Não usa comandos que imprimem credenciais. O próprio CLI pode renovar OAuth expirado durante essa checagem, conforme seu comportamento normal. |
| OpenCode | `opencode auth list --format json`: procura uma conexão autenticada no provedor correspondente ao prefixo do modelo padrão. Uma conta de outro provedor não confirma esse modelo. Formatos antigos ou desconhecidos ficam sem confirmação; provedores locais/ambientais sem credencial listada não são declarados deslogados automaticamente. |
| Muse | `muse usage --json`: uma resposta schema v1 com allowance preenchido confirma a consulta autenticada. Allowance ausente/null não comprova login; uma negativa explícita de autenticação indica necessidade de entrar. |
| ACP | Faz `initialize` e `session/new`, sem enviar `session/prompt`. `auth_required` indica que é necessário entrar; aceitar a sessão confirma prontidão no protocolo. |
| API OpenAI-compatible | Consulta `GET /models`. HTTP 401 indica necessidade de autenticar/corrigir a chave. Uma lista pública bem-sucedida permanece como login não verificado, pois não comprova acesso ao chat. Outros erros, inclusive permissões/limites, ficam separados de falta de login. |
| Grok, Gemini, Antigravity, Copilot e Kimi nativos | Verificam instalação/versão. Esta integração ainda não dispõe de uma checagem segura e documentada de login para esses CLIs; mostra login não verificado quando instalados. Você pode conferir o login pelo terminal. |

A instalação e os comandos de autenticação recebem o mesmo ambiente de credenciais usado pela execução. O modelo padrão da conexão é passado às verificações que dependem dele. Em Copilot, a chave salva usa `COPILOT_GITHUB_TOKEN`, a variável reconhecida pelo CLI, além das alternativas GitHub existentes.

Versão bem-sucedida e presença de variável de ambiente, isoladamente, nunca confirmam login. As checagens não executam um turno de modelo, não abrem fluxos de login e têm timeout. Não retornam JSON bruto de contas, e-mails, tokens ou diagnósticos de autenticação ao renderer. Problemas ao abrir a chave no cofre também impedem mostrar a conexão como pronta.

Prontidão de credenciais locais não garante saldo, cota, autorização para todos os modelos ou disponibilidade futura do serviço. Se uma versão mudar o formato de resposta, a checagem fica inconclusiva em vez de assumir sucesso.

Referências: [Codex](https://learn.chatgpt.com/docs/cli/reference), [Claude](https://code.claude.com/docs/en/cli-reference), [Pi](https://pi.dev/docs/latest/cli#credential-commands), [OpenCode](https://dev.opencode.ai/v2/docs/cli/commands/) e [implementação oficial da lista de autenticação](https://github.com/anomalyco/opencode/blob/dev/packages/cli/src/commands/handlers/auth/list.ts). O comando e o formato de Muse foram conferidos no help e na resposta do CLI instalado. O comportamento ACP segue a [configuração de sessão](https://agentclientprotocol.com/protocol/v1/session-setup).
