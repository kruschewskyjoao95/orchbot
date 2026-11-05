# Ferramentas MCP e autoridade dos engines

Em **Skills e Plugins → MCP**, selecione o agente e vincule os servidores.
**Ferramentas…** define uma política para aquele agente e servidor, sem mudar
as regras dos demais agentes. O painel mostra a autoridade que o adapter solicita;
ela também aparece no diagnóstico exportado em Configurações.

## Política por ferramenta

Use o nome original da ferramenta MCP, um por linha, sem prefixo de servidor.
São aceitos até 128 nomes por lista, de até 128 caracteres: letras ASCII, números,
`_`, `-` e `.`. Não há padrões, curingas, regras por argumento ou filtros para
ferramentas nativas. A lista de bloqueio prevalece.

- **Codex:** permite listas de permissão e bloqueio. Com **Permitir somente**
  marcado, uma lista vazia não permite ferramenta alguma. Desmarcado, conserva
  o catálogo exceto pelos nomes bloqueados.
- **Claude:** aplica a lista de bloqueio. O Orchbot não usa `--allowedTools`
  como lista exclusiva: esse controle concede aprovação automática, não limita
  o catálogo. Nomes com ponto são recusados nesta integração por falta de
  contrato verificado para essa forma de nome.
- **Remover restrições** limpa a política deste vínculo; as regras próprias do
  engine continuam sob sua configuração local.

O filtro é delegado ao CLI: Codex recebe `enabled_tools`/`disabled_tools`; Claude
recebe regras `mcp__servidor__ferramenta` em `--disallowedTools`. Segundo os
contratos nativos, a ferramenta bloqueada é retirada do catálogo e recusada na
chamada. Não se trata de uma instrução pedindo ao modelo que evite a ferramenta.
[Configuração Codex](https://developers.openai.com/codex/config-reference),
[permissões Claude](https://code.claude.com/docs/en/permissions),
[CLI Claude](https://code.claude.com/docs/en/cli-reference).

O código primário do Codex consultado no commit
`ee80baa38e3919061e0e0ad022aba1d9fbfc5dbc` aplica o filtro tanto no catálogo quanto
em `validate_tool_call` antes de encaminhar chamadas:
[catálogo](https://github.com/openai/codex/blob/ee80baa38e3919061e0e0ad022aba1d9fbfc5dbc/codex-rs/codex-mcp/src/connection_manager/tool_catalog.rs),
[chamada](https://github.com/openai/codex/blob/ee80baa38e3919061e0e0ad022aba1d9fbfc5dbc/codex-rs/codex-mcp/src/connection_manager.rs#L1310-L1350).

Para turnos restritos, o Orchbot exige uma resposta de versão reconhecida e
mínimos conservadores: **Codex 0.166.0** ou **Claude Code 2.1.318**. Estes são os
contratos adotados nesta implementação, não a alegação de que a funcionalidade
surgiu nessas versões. Versão antiga, erro ou resposta inconclusiva bloqueiam o
turno antes do prompt. Turnos sem restrições novas não exigem essa checagem.

## O que cada adapter aplica

| Engine no Orchbot | MCP configurado no app | Filtro por ferramenta | Modo cauteloso para ferramentas nativas |
| --- | --- | --- | --- |
| Codex | stdio e HTTP | Permissão e bloqueio nativos | Solicita `read-only`; turno aprovado solicita `workspace-write` |
| Claude | stdio e HTTP, configuração estrita | Bloqueio nativo | Solicita modo manual e encaminha pedidos de aprovação |
| ACP genérico | stdio; HTTP se anunciado pelo agente | Não aplicado | Encaminha pedidos quando o agente os emite |
| Antigravity | Mesmo transporte ACP | Não aplicado | Mesmo comportamento ACP |
| Gemini | Não encaminhado pelo adapter | Não aplicado | Configuração do CLI |
| Grok | Não encaminhado pelo adapter | Não aplicado | Configuração do CLI |
| Muse | Não encaminhado pelo adapter | Não aplicado | Configuração do CLI |
| OpenCode | Não encaminhado pelo adapter | Não aplicado | Configuração do CLI |
| Pi | Não encaminhado pelo adapter | Não aplicado | Configuração do CLI |
| Kimi | Não encaminhado pelo adapter | Não aplicado | Configuração do CLI |
| Copilot | Não encaminhado pelo adapter | Não aplicado | O adapter usa `--allow-all-tools`, inclusive no modo cauteloso do app |
| APIs OpenAI-compatible | Não implementado neste adapter | Não aplicado | Sem execução nativa de ferramentas neste adapter HTTP |

Essa matriz descreve os adapters atuais, não todas as capacidades que os produtos
upstream possam oferecer. Escolhas de servidores para engines sem transporte
continuam salvas, mas o painel avisa que não são aplicadas. Uma política restrita
não é ignorada: se o agente mudar para um engine incompatível, o turno falha.
Isso vale também para troca automática de provedor após erro de cota.

## Retomada e alterações

Alterar vínculos ou regras exige parar o turno em andamento, inclusive quando
espera aprovação. Não se altera a configuração de um CLI que já está executando.
Mudanças valem no próximo turno. Configuração MCP e políticas entram no escopo
da sessão: uma mudança inicia sessão nativa nova, conservando o histórico local.
Compactor e curador recebem a mesma configuração MCP do turno principal.

Os vínculos antigos migram sem nova restrição. Alterar outro servidor preserva
as regras dos vínculos mantidos. Política corrompida ou erro ao abrir os segredos
impede execução; o turno não continua silenciosamente sem MCP. O diagnóstico
informa políticas inválidas, sem incluir nomes de ferramentas ou credenciais.
Pacotes de equipe continuam sem transportar MCP, contas ou estas políticas.

## Limites do diagnóstico

**Autoridade solicitada** descreve as opções enviadas ao adapter. O modo resolvido
do sandbox não é observado pelo Orchbot. Para um CLI autônomo, o relatório diz
que herda a configuração; não presume acesso total nem isolamento.

O Orchbot não adiciona sandbox de processos. Pastas por agente e partições de
browser não isolam os processos de CLI no disco ou na rede. `read-only` do
filesystem Codex não impede que MCP altere serviços remotos. Autorizar shell
pode permitir chamadas de API ou programas fora do caminho MCP filtrado.

No Codex, a política cobre os servidores vinculados no Orchbot; MCP e plugins
adicionais do perfil nativo podem permanecer disponíveis. No Claude, a seleção
de MCP usa `--strict-mcp-config`, inclusive quando vazia. Permissões nativas,
configurações locais, hooks/mods e a implementação do CLI continuam relevantes;
não há um proxy independente de autorização nesta versão.

Os testes cobrem persistência, validação, flags e retomada com CLIs de fixture,
bloqueio por incompatibilidade/versão, failover, cancelamento e propagação para
manutenção de memória. Não fazem chamadas pagas nem afirmam comprovar a segurança
interna de cada CLI real. Não houve verificação visual manual dos controles.
