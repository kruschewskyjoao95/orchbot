# Implementação da análise aprovada

Direção aprovada pela pessoa: [analysis.md](analysis.md). Implementação em 04/11/2026 sobre as alterações locais já existentes na branch `feat/openbot-visual`.

## O que mudou

| Achado | Ajuste aplicado |
|---|---|
| Leitura das respostas | Parágrafos, títulos, listas, ênfase, links HTTP(S) e código renderizados por JSX, sem inserir HTML do modelo. As mensagens da pessoa continuam como texto. Os cartões estruturados de delegação e os blocos de código existentes foram preservados. |
| Lateral compacta | Estado vazio de grupos aparece só na versão expandida. Grupos e arquivados têm acessos compactos com nomes acessíveis. Agentes mantêm nome completo e estado no rótulo acessível. |
| Escolha inicial | Provedores prontos vêm primeiro. Os demais ficam em uma seção nativa recolhível com orientação e acesso direto à configuração. A escolha continua explícita e é persistida antes de fechar a tela. |
| Provedores | Removidos título duplicado, emojis decorativos e criação de agente dessa tela. Lista e formulário ficam lado a lado em 1280 px; em janelas menores, a lista tem altura limitada. O provedor principal é a seleção inicial. |
| Vocabulário | Os fluxos principais usam agente, conversa, grupo e coordenador. A paleta de comandos acompanha os rótulos, preservando aliases de busca. O início tem um acesso único na barra. |
| Cabeçalho e conversas | Delegação e configuração continuam disponíveis no menu Ações. Cabeçalho cabe em uma linha em 900 × 600. Abas perderam decoração repetida e receberam controles maiores e rótulos acessíveis. |
| Criação | Nome vem antes do avatar opcional; IA ocupa sua própria linha. Modelo, atualização e raciocínio ficam alinhados. Seções avançadas continuam recolhidas. |
| Tema claro | Turnos da pessoa têm superfície própria e respostas possuem borda sutil para manter o agrupamento. |
| Precisão e teclado | Áreas de clique pequenas foram ampliadas. Diálogos do App, consentimento, contas e criação de grupos usam o mesmo confinamento de Tab e restauração de foco. Escape foi corrigido nos diálogos de criação, configurações e configuração do provedor. |

A verificação encontrou também um defeito de zoom: os diálogos usavam dimensões de viewport que eram ampliadas novamente pelo `zoom` da interface. O contêiner agora ocupa o espaço disponível e os limites principais usam percentuais, mantendo criação e configurações dentro da janela a 125%.

Nenhuma dependência foi adicionada. Não houve alteração de schema, histórico ou lógica de execução dos agentes. Na abertura, um banco que já tem agente, conversa ou mensagem grava a escolha inicial como feita. Uma instalação vazia continua vendo a tela. O provedor principal só muda quando a pessoa escolhe. Os estados internos e nomes das APIs continuam os mesmos.

## Checks concluídos

- `bun run typecheck`.
- Biome nos dez arquivos de código/teste alterados nesta implementação e `git diff --check`.
- `bun run build`, com renderer de produção gerado.
- **29 testes passando** nas suítes `message-markdown`, `orchestration-ui`, `settings`, `foreman` e `distribution`.
- A nova suíte de formatação verifica ênfase, listas, numeração, quebras de linha, código completo/incompleto e rejeição de protocolos executáveis ou locais.

No Electron real, com perfil e banco temporários, foram executadas asserções para:

1. Negrito e listas virarem elementos semânticos na conversa.
2. HTML malicioso permanecer como texto, nenhum `img`/`script` ser criado e somente o link HTTPS válido virar âncora. O código HTML cercado por crases permaneceu literal.
3. Lateral sem overflow horizontal e cabeçalho com 40 px em 900 × 600; grupos e arquivados continuam acessíveis.
4. Delegação e configuração presentes no menu Ações.
5. Provedores prontos separados dos demais; seção Outros provedores expandível com controles visíveis.
6. Acesso à configuração a partir do primeiro uso e persistência da escolha pelo botão Começar.
7. Tab e Shift+Tab circularem dentro da criação; Escape fechar a criação; configurações devolverem foco ao botão de abertura.
8. Escape fechar apenas a configuração do provedor, mantendo as configurações gerais abertas.
9. Criação e configurações caberem no viewport de 900 × 600 com tamanho da interface em 125%.
10. Superfície do turno da pessoa e borda da resposta no tema claro.

## Capturas

- [Primeiro uso](after/01-first-use.png).
- [Criação de agente](after/03-create-agent.png).
- [Conversa escura](after/04-chat.png).
- [Conversa em 900 × 600](after/05-chat-small.png).
- [Provedores](after/07-providers.png).
- [Conversa clara](after/08-chat-light.png).
- [Criação em 900 × 600 com zoom de 125%](after/09-create-agent-zoom.png).

As dimensões foram controladas pelas métricas do Chromium na instância Electron. As capturas usam conteúdo demonstrativo e não comprovam comportamento de todos os gerenciadores de janelas. A instância temporária foi encerrada.

## Limites

O Markdown é deliberadamente básico: não cobre tabelas, listas aninhadas nem toda a gramática CommonMark. Os limites estão anotados no parser. HTML arbitrário não é aceito.

Não foram executados turnos reais nos provedores, validação com leitor de tela, matriz completa de todos os diálogos e níveis de zoom, ou testes Windows/macOS. Não houve publicação, commit ou PR nesta etapa.
