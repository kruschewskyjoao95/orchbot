# Análise de design do Orchbot — 04/11/2026

## Diagnóstico

O Orchbot já tem uma base visual coerente para um aplicativo de trabalho: superfícies neutras, navegação discreta, conversa como área principal e configurações organizadas por categoria. A próxima melhoria deve concentrar-se na leitura das respostas, na adaptação a janelas menores e na consistência dos fluxos. Outra troca de paleta ou de fonte teria impacto menor.

A referência OpenBot ajuda principalmente pela distribuição de responsabilidades: navegação global na barra estreita, agentes na lateral, assuntos no cabeçalho e composição no rodapé. O Orchbot já adotou boa parte dessa estrutura. Persistem diferenças importantes na quantidade de ações do cabeçalho, no conteúdo da lateral e na apresentação das configurações de provedores.

## Escopo e método

- Checkout atual: branch `feat/openbot-visual`, incluindo as alterações locais existentes. Nenhuma implementação do produto foi alterada nesta análise.
- Build atual executado com `bun run build`, concluído sem erro.
- Capturas novas do Electron real, com perfil e banco temporários. Quatro agentes e uma conversa foram preparados como dados demonstrativos; nenhuma tarefa de IA foi executada.
- Viewports do Orchbot: 1280 × 800 e 900 × 600, por emulação de métricas do Chromium. Isso verifica o layout nessas dimensões, sem comprovar o comportamento do gerenciador de janelas nativo.
- Temas claro e escuro na conversa. Não foi feita uma matriz completa de temas por tela.
- Referência fornecida: `/home/joao/Documents/Craft Anything/openbot-0-53-2-x86-64`. Foram lidos `app/MECHANICS.md`, `app/src/main.rs` e os metadados do projeto. A reprodução Rust foi executada e capturada novamente.
- A captura da referência tem 1901 × 1048. Não é uma comparação de pixels com o Orchbot. A reprodução contém comportamentos simulados e estimativas documentadas; não substitui um teste do OpenBot original.
- A tela de escolha inicial foi reaberta no perfil temporário após criar os agentes. O fundo com equipe preenchida não representa uma instalação vazia.

## Fluxo observado

| Etapa | Superfície | Saúde geral | Evidência |
|---|---|---|---|
| 0 | Reprodução OpenBot | Referência de composição, sem validar o produto original | [Captura](00-openbot-reproduction.png) |
| 1 | Escolha inicial de IA | Compreensível, mas exige comparar muitas opções técnicas | [Captura](01-first-use.png) |
| 2 | Início | Boa hierarquia principal; identidade do coordenador pouco clara | [Captura](02-home.png) |
| 3 | Criar agente | Formulário mais focado; distribuição dos campos pode melhorar | [Captura](03-create-agent.png) |
| 4 | Conversa escura | Estrutura legível; formatação da resposta e hierarquia têm falhas | [Captura](04-chat.png) |
| 5 | Conversa em 900 × 600 | Comprometida por conteúdo inadequado à lateral compacta | [Captura](05-chat-small.png) |
| 6 | Configurações gerais | Consistente e compreensível, com bastante conteúdo vertical | [Captura](06-settings.png) |
| 7 | Provedores | Funciona visualmente como uma tela de outra geração do app | [Captura](07-providers.png) |
| 8 | Conversa clara | Texto legível; distinção entre mensagens fica mais fraca | [Captura](08-chat-light.png) |

## O que preservar

1. **Navegação global discreta.** Ícones monocromáticos, indicação de seleção e nomes acessíveis na barra principal criam uma base consistente.
2. **Modelo e raciocínio visíveis.** A pessoa consegue perceber e ajustar essas escolhas no fluxo de conversa e de criação. Não devem desaparecer dentro de configurações avançadas.
3. **Criação com opções secundárias recolhidas.** Perfis prontos, geração por IA e permissões não disputam mais toda a tela com o formulário básico.
4. **Configurações com categorias e busca.** A organização geral é uma boa referência interna para atualizar a tela de provedores.
5. **Compositor estável no rodapé.** Anexos, menções, autonomia, modelo e esforço estão concentrados no mesmo lugar. Não há uma lista permanente de todos os colegas dentro do campo.
6. **Estados com texto.** A prontidão de provedores usa rótulos como “Pronto” e “Login não verificado”, ajudando a não depender exclusivamente de cores.

## Achados por prioridade

### 1. P1 — A resposta perde estrutura porque parte do Markdown aparece cru

**Evidência:** etapas 4 e 8. O texto demonstrativo `**Prioridade alta:**` aparece com os asteriscos visíveis. As listas são exibidas como linhas com hífen. A inspeção do renderer confirma que blocos textuais são apresentados como conteúdo de texto em `.msg-text-segment`; há tratamento separado para código.

**Impacto:** respostas longas ficam mais difíceis de percorrer e os destaques que deveriam orientar a leitura viram ruído. Esse problema afeta diretamente a entrega central do produto.

**Recomendação:** apresentar a estrutura comum das respostas — ênfase, listas e links — com renderização segura, preservando os blocos de código e os cartões estruturados existentes. Evitar HTML arbitrário vindo do modelo. Não é necessário implementar um editor rico.

**Aceite:** a resposta de demonstração mostra prioridades destacadas e listas estruturadas; texto não confiável continua sem executar HTML ou script.

### 2. P1 — A lateral compacta reduz largura, mas mantém conteúdo de lateral expandida

**Evidência:** etapa 5, em 900 × 600. “Nenhuma sala em grupo criada” quebra em uma coluna de palavras; “Ver salas arquivadas” também se fragmenta. Há uma barra de rolagem horizontal na própria lateral. O documento principal não apresentou overflow horizontal.

**Impacto:** o modo compacto parece quebrado e dedica espaço a estados vazios pouco úteis. Dois agentes também compartilham as iniciais “RE”, tornando a identificação menos imediata quando os nomes somem.

**Recomendação:** definir conteúdo específico para o modo compacto: avatares, estados e ações essenciais. Levar a explicação do grupo vazio para a seção de grupos; preservar acesso à criação e aos arquivados por um controle apropriado. Garantir identificação completa por nome acessível, foco e tooltip.

**Aceite:** nenhuma frase se empilha verticalmente, a lateral não rola horizontalmente e todas as funções continuam alcançáveis por teclado e ponteiro.

### 3. P1 — A entrada por provedores cobra uma decisão técnica grande antes do primeiro valor

**Evidência:** etapa 1. Onze opções aparecem com peso visual semelhante, incluindo alternativas não instaladas e falhas de checagem. Agente ACP aparece antes de provedores prontos. “Login não verificado” não explica, nessa tela, qual ação resolve a incerteza.

**Impacto:** alguém que quer simplesmente começar precisa interpretar disponibilidade, instalação e autenticação de várias ferramentas. A variedade de emojis acrescenta saliência sem orientar a escolha.

**Recomendação:** priorizar provedores prontos e oferecer as demais alternativas em “Outros provedores”. Para estados inconclusivos, mostrar uma próxima ação clara, como verificar ou configurar. Preservar a opção de configurar depois e a escolha explícita da pessoa.

**Aceite:** o caminho para começar com um provedor pronto é evidente; indisponíveis continuam descobríveis; cada estado problemático oferece orientação útil.

### 4. P2 — A tela de provedores rompe a consistência visual e de contexto

**Evidência:** etapa 7. Há um segundo título “Conexões & Provedores de IA”, texto introdutório longo, emojis grandes, seletor de provedor principal com aparência nativa diferente e um botão primário “+ Novo Agente” dentro da configuração de conexões. A lista ocupa praticamente toda a altura visível antes da configuração detalhada abaixo.

**Impacto:** fica menos claro se a tarefa é conectar uma IA, editar uma conexão ou criar um agente. A interface perde a continuidade com as configurações gerais.

**Recomendação:** reutilizar a tipografia, os controles e o espaçamento de Geral; usar um título e uma explicação curta; organizar a lista em torno de nome, prontidão, ativação e configuração. O destaque principal dessa tela deve servir à conexão de provedores. A criação de agente já possui acessos no fluxo principal.

**Aceite:** é possível entender o estado e abrir a configuração de uma conexão sem atravessar uma segunda linguagem visual.

### 5. P2 — Os nomes do produto não formam um vocabulário estável

**Evidência:** etapas 2 a 4. Aparecem “Central”, “coordenador”, “assistente”, “agente”, “colega”, “equipe”, “salas em grupo”, “assuntos” e “Nova Conversa”. Na instalação vazia, o item lateral “Peça na Central para montar a equipe” é truncado e ocupa o lugar visual de uma identidade.

**Impacto:** a pessoa precisa deduzir quais palavras representam a mesma entidade e quais representam funções diferentes. O coordenador tem tratamento especial, mas sua relação com o início não fica imediatamente clara.

**Recomendação:** escolher um termo principal para o agente, outro para a conversa e outro para o grupo. Identificar o coordenador por um nome curto e estável; colocar a explicação do que ele faz em um estado vazio ou ajuda contextual. O ícone de início e o logotipo também levam ao mesmo destino; avaliar se ambos precisam permanecer como ações separadas.

**Aceite:** a mesma entidade mantém seu nome no início, na lateral, nos botões e nos diálogos.

### 6. P2 — O cabeçalho e as abas ainda gastam espaço com ações secundárias

**Evidência:** etapas 4 e 5. O cabeçalho expõe Conversa, Navegador, Passar tarefa, Ajustes e Mais. A faixa abaixo acrescenta “ASSUNTOS:”, o ícone de conversa, o lápis e “Nova Conversa”. Na janela menor, as ações do cabeçalho ocupam outra linha antes da faixa de assuntos.

**Impacto:** os controles crescem verticalmente antes do conteúdo. A referência concentra identidade e assuntos numa faixa mais contida, deixando poucas ações no extremo direito.

**Recomendação:** priorizar identidade e assunto ativo; agrupar ações menos frequentes num menu de contexto com acesso claro. Escolher um único padrão de “conversa/assunto”. Em largura menor, reduzir primeiro as ações permanentes antes de aumentar o número de linhas. Preservar a descoberta de delegação e navegador.

**Aceite:** a janela menor mantém uma área útil de leitura sem perder acesso a tarefas, ajustes e assuntos.

### 7. P2 — A criação de agente tem espaço mal distribuído no bloco de modelo

**Evidência:** etapa 3. IA e Modelo ficam lado a lado. O botão “Atualizar” ocupa uma linha própria abaixo do modelo; o raciocínio fica na mesma metade direita, deixando uma grande área vazia sob IA. O formulário quase preenche os 800 px de altura disponíveis.

**Impacto:** campos relacionados parecem se estender por linhas sem uma organização clara, e a ação secundária de atualizar modelos ocupa espaço valioso.

**Recomendação:** manter IA numa linha clara e agrupar modelo e raciocínio numa linha seguinte, com atualização junto ao seletor de modelos. Avatar pode continuar opcional, com menos destaque que nome e instruções. Preservar as seções recolhíveis já implementadas.

**Aceite:** nome, IA, modelo, raciocínio e instruções têm ordem de leitura inequívoca; a atualização não cria uma linha isolada.

### 8. P2 — O tema claro enfraquece a separação dos turnos

**Evidência:** etapa 8. As superfícies das mensagens se aproximam visualmente do fundo branco. A autoria depende bastante do alinhamento e de metadados pequenos em cinza. O tema escuro oferece agrupamentos mais perceptíveis.

**Impacto:** fica mais trabalhoso perceber onde começa e termina uma resposta, especialmente com texto comprido e blocos sem formatação.

**Recomendação:** definir a apresentação das mensagens especificamente para o tema claro: tratamento perceptível para o turno da pessoa e agrupamento estável para respostas, por superfície, espaçamento ou separadores. Manter a mesma hierarquia de autoria em ambos os temas.

**Aceite:** é fácil distinguir autoria e limites dos turnos em claro e escuro, sem depender apenas da posição na tela.

### 9. P2 — Alguns controles exigem precisão demais

**Evidência:** na etapa 8, a inspeção de retângulos encontrou “Nova sala em grupo” com 22 × 22 px, o lápis de renomear com aproximadamente 20 × 14 px e a aba de conversa com 19 px de altura. “Ver salas arquivadas” tem 14 px de altura. A barra principal, em contraste, já apresenta controles maiores e com nomes acessíveis.

**Impacto:** aumenta a dificuldade para pessoas com pouca precisão motora ou que usam ampliação. O lápis depende de `title` para explicar sua função; convém dar-lhe um nome acessível explícito.

**Recomendação:** ampliar as áreas interativas mantendo os desenhos pequenos, padronizar rótulos acessíveis e verificar foco, ordem de tabulação e comportamento dos diálogos.

**Aceite:** os controles pequenos podem ser usados sem apontar com precisão; foco visível e nome da ação são inequívocos. Dimensões isoladas não bastam para concluir conformidade ou violação de WCAG, pois há critérios de espaçamento e exceções.

## Como usar a referência

O levantamento fornecido documenta barra global de 52 px, lateral padrão de 280 px, lateral compacta de 88 px, cabeçalho de 38 px e compositor com altura mínima de 96 px. Esses números são evidência do material de referência, não metas universais para o Orchbot.

Adotar os princípios por trás deles: papéis distintos para cada região, poucas ações permanentes, prioridade para leitura e um modo compacto que realmente muda o conteúdo. Preservar os recursos próprios do Orchbot, como projetos, autonomia e esforço de raciocínio. A referência não demonstra que copiar cada medida ou balão melhoraria todos esses fluxos.

Na lateral, a reprodução prioriza a última mensagem ou atividade do agente. O Orchbot mostra descrição estática e data. Para acompanhar trabalho diário, vale priorizar estado acionável e atividade recente; manter a descrição como informação de identidade secundária.

## Ordem recomendada

1. Corrigir leitura de respostas e lateral compacta: são problemas visíveis durante o uso principal.
2. Simplificar a escolha inicial e alinhar Provedores com o restante das configurações.
3. Padronizar nomes e reduzir a altura do cabeçalho de conversa.
4. Ajustar a grade de criação, a hierarquia do tema claro e os alvos pequenos.
5. Repetir os mesmos fluxos com teclado, zoom e conteúdo longo antes de considerar o trabalho visual fechado.

Não proponho uma nova biblioteca de componentes nem uma reescrita da interface. Há padrões internos suficientes para completar essa direção.

## Limites

Não foram testados leitores de tela, navegação completa por teclado, foco preso em diálogos, contraste de todos os estados, zoom, erros de formulário, streaming real, execução de delegação, navegador controlado, todas as telas ou instalação Windows/macOS. A conversa foi inserida no banco temporário para avaliar sua apresentação, sem execução nos provedores. Falhas de checagem visíveis não foram diagnosticadas nesta auditoria.

O relatório é uma avaliação de UX e design com capturas atuais e inspeções pontuais do DOM/código, não uma certificação de acessibilidade. Não foram executados testes automatizados de regressão, pois nenhuma implementação foi alterada. A instância temporária foi encerrada ao terminar as capturas.
