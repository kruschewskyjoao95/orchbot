# Pacote mínimo de equipe

Um pacote `.orchbot-team.json` transporta a configuração de uma equipe para
outra instalação ou para um projeto novo na mesma instalação. Funciona offline,
sem dependências adicionais.

## Exportar

Use **Exportar equipe** (↗) no cabeçalho de uma pasta de projeto ou em **Sua
Equipe**. A exportação inclui todos os agentes desse agrupamento, mesmo se a
busca da lateral estiver filtrada. Revise o conteúdo no diálogo e escolha
**Salvar arquivo**.

O arquivo contém nome/descrição do projeto, identidade e instruções dos agentes,
texto das skills vinculadas, títulos/objetivos dos grupos e referências aos seus
membros e donos. Uma skill compartilhada por vários agentes aparece uma vez.
Grupos só entram quando o dono e todos os participantes pertencem à equipe;
grupos mistos e o coordenador fixo do aplicativo ficam fora. Grupos arquivados
também podem viajar como configuração, sem seu histórico ou estado.

Contas, provedores/modelos, credenciais, caminhos locais, permissões, conexões
MCP, memória, cérebro do projeto, conversas, anexos, rotinas, webhooks e cadeias
de execução ficam fora. Só o texto de `SKILL.md` é transportado, sem scripts,
arquivos auxiliares ou histórico de versões.

O mascaramento de segredos usa os detectores já existentes no Orchbot, na
exportação e na importação. Não identifica todo dado privado escrito nas
instruções: revise o conteúdo antes de compartilhar. O arquivo é salvo por
substituição após gravação temporária, com permissão privada onde o sistema a
suporta; uma falha antes da substituição mantém o arquivo anterior.

## Importar

No menu **Criar (+)**, escolha **Importar equipe…**, selecione o arquivo e revise
as instruções e skills antes de confirmar. Cancelar não cria registros ou pastas.
Não é necessário iniciar um agente para importar.

A importação sempre cria um projeto novo e IDs novos. Nomes e slugs em colisão
recebem sufixos; registros e skills existentes não são sobrescritos. As pastas
de trabalho novas ficam em `~/Orchbot/equipe-*/agente-*`; nenhum caminho do
arquivo é aceito como destino.

Os agentes usam o provedor habilitado escolhido como padrão nesta instalação e
seu modelo padrão; se ele não estiver habilitado, usam o primeiro provedor
habilitado da lista local. Se nenhum estiver habilitado, a importação é recusada.
Não há migração de conta ou login. A execução posterior usa a configuração local
normal desse provedor.

Agentes chegam cautelosos, sem MCP, navegador, scripts locais, computador ou
abertura automática de conversas. Esses valores são explícitos para não herdar
capacidades mais amplas dos padrões do computador. Grupos chegam parados e
nenhuma tarefa é agendada.

Os vínculos de skills são preservados: skills são instruções, não permissões de
ferramentas. Seu texto passa a estar disponível aos agentes importados; revise-o
no diálogo. O formato não concede capacidade de executar scripts ou comandos
automaticamente. Instruções importadas continuam sendo conteúdo não confiável.

## Contrato e limites

O formato é `orchbot.team`, versão `1`, com os campos obrigatórios `project`,
`agents`, `skills` e `channels`. As referências entre eles usam chaves internas
do pacote. Campos desconhecidos, inclusive campos de autoridade, versões não
suportadas e referências inválidas são recusados antes de qualquer gravação.

Limites por pacote: 2 MiB, 20 agentes, 40 skills e 40 grupos. Instruções de agente
e de canal seguem o limite atual do aplicativo (2.000 caracteres); cada skill tem até
40 KiB de corpo. A pasta compartilhada do canal fica nesta instalação e não viaja
no pacote. O pacote não é compatível diretamente com arquivos OpenMausBot.

Os registros SQLite são criados numa transação. Falhas de importação desfazem o
banco e removem as skills e pastas recém-criadas; falhas de limpeza são reportadas.
Uma queda abrupta do processo pode deixar arquivos de skills ou pastas sem
vínculos, pois filesystem e SQLite não compartilham uma transação. Não há diário
de recuperação ou sincronização de pacotes nesta versão.

O pacote também não transporta runtime Docker, broker GitHub ou habilitação do
controle externo. Configure a execução local após importar; colegas importados
começam no runtime host. [Configuração e fronteira Docker](control-and-runtime.md).
