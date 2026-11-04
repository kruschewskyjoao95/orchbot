# Base para simplificar a interface do Orchbot

## Escopo e evidência

Análise da hierarquia visual e da estrutura dos estilos, sem implementar uma nova interface nesta etapa. Capturas novas do Orchbot em 1280 × 720, Electron com perfil temporário; navegação, menções, configurações e criação de agente verificadas sem executar tarefas reais nos provedores.

A referência fornecida contém o renderer extraído do OpenBot e uma reprodução Rust. Foram lidos o CSS original, o trecho `Layout` do bundle `index-wergrzJR.js` e `app/MECHANICS.md`. A [captura de referência](reference.png) foi feita agora pela reprodução Rust; não foi executado o aplicativo OpenBot original. Portanto, ela apoia a composição visual, mas não comprova todos os comportamentos do produto original.

## O que explica a diferença

O OpenBot distribui as funções por contexto. O Orchbot mantém muitas funções visíveis ao mesmo tempo. Trocar cores, fontes e bordas preservando essa estrutura mantém o excesso de informação.

Na referência, a barra de navegação usa ícones monocromáticos e a lateral prioriza agentes. O cabeçalho de conversa tem 38 px; o compositor tem altura mínima de 96 px. A lateral pode ficar compacta com 88 px. O código original decide a compactação conforme o espaço disponível para a conversa, em vez de depender exclusivamente da resolução da tela. Esses valores orientam proporções; não precisam ser impostos a telas com controles diferentes.

## Fluxo observado

1. **Abrir uma conversa — carregado.** [Captura](01-chat.png). Seleção de agente e conversa funcionam. Cabeçalho, lateral e compositor competem com o conteúdo por atenção.
2. **Abrir configurações — funcional, mais consistente.** [Captura](02-settings.png). Navegação por categorias e ícones pequenos já oferecem uma base melhor para o restante do app. Textos explicativos e espaçamento tornam o formulário alto em 720 px.
3. **Criar um agente — funcional, excesso de entrada.** [Captura](03-create-agent.png). Perfis prontos, geração por IA e formulário manual aparecem juntos. Muitos botões têm dois emojis. Os campos de modelo e raciocínio ficam depois de uma área grande de sugestões.

## Achados e mudanças concretas

### 1. P1 — Cabeçalho e compositor repetem navegação e ações

Evidência: na conversa há Início, papel, descrição, Conversa/Navegador, Passar Tarefa, Ajustes e Mais; o compositor repete colegas e Central da Equipe.

Mudar: cabeçalho com identidade, assuntos e ações de contexto. Manter configurações em um acesso claro; ações pouco frequentes em Mais. Tirar o atalho fixo de Central do compositor, pois a navegação principal já leva ao início. Preservar uma forma clara de delegar, evitando manter a lista inteira de colegas permanentemente no campo de mensagem.

### 2. P1 — Criar agente apresenta três caminhos simultâneos

Evidência: grande lista de perfis, bloco para pedir rascunho à IA e formulário manual na mesma coluna.

Mudar: formulário básico primeiro: nome, provedor, modelo, raciocínio e instruções. Perfis prontos e geração por IA ficam em seções recolhíveis com nomes distintos. Usar “Perfis prontos” em vez de “Modelos Prontos de Coworker”, para não confundir perfil do agente com modelo de IA. **Modelo e raciocínio continuam juntos e visíveis**, conforme solicitado.

### 3. P2 — Emojis funcionam como decoração repetida

Evidência: ferramentas na descrição de cada agente, selo de especialista, botões de ações e perfis com avatar mais um segundo emoji de papel.

Mudar: retirar emojis dos rótulos do sistema. Usar uma única família de ícones monocromáticos em navegação e ações. Manter emojis escolhidos pela pessoa como avatar e dentro das mensagens. Não substituir cada emoji por outro ícone se o texto já explica a ação; muitos rótulos podem ficar só com texto.

### 4. P2 — Papel e contexto aparecem mais vezes que o necessário

Evidência: “Assistente • …” em cada linha, papel no cabeçalho e, no coordenador, outra faixa com explicação e colegas.

Mudar: mostrar nome e descrição curta na lateral, sem prefixo fixo de papel. Manter papel nos ajustes; indicar o coordenador discretamente quando necessário. Estado ativo, pausa, erro e pedido de aprovação merecem destaque; informações estáveis não precisam de selos permanentes em todas as superfícies.

### 5. P2 — O compositor cresce conforme aumenta a equipe

Evidência: lista permanente de colegas ocupa outra faixa acima das opções de envio.

Mudar: compositor compacto com anexos, modelo, raciocínio e enviar/parar. Colegas aparecem por uma ação “Mencionar” ou ao digitar `@`. Manter o estado de autonomia/permissão perceptível, com a mudança de configuração acessível, sem repetir explicações longas.

### 6. P2 — Reduzir a janela apenas redistribui a mesma quantidade de controles

Evidência: cabeçalho quebra em mais linhas; criação do agente exige rolagem antes dos campos essenciais. O OpenBot possui um modo compacto real para a lateral.

Mudar: definir prioridades quando falta espaço: conversa primeiro, lateral compacta depois, ações secundárias sob demanda. A lateral compacta precisa preservar busca, criação, nomes acessíveis e acesso aos projetos. Não resolver escondendo controles com CSS sem oferecer outro acesso.

### 7. P2 — A cascata do CSS acumula decisões sobre o mesmo componente

Evidência no `styles.css` atual, com 5.311 linhas: `.sidebar-header` é definido perto das linhas 233 e 4949; `.agent-item`, perto de 341 e 4968; `.agent-avatar`, perto de 358 e 4976; `.composer-settings-link` aparece em três blocos. Há valores substituídos mais abaixo, como raio de 12 px passando a 8 px em `.agent-item`.

Mudar: consolidar a regra base de cada componente e manter suas variações responsivas próximas. Algumas repetições dentro de media queries são legítimas; não apagar regras apenas porque o seletor se repete. Separar por responsabilidade, por exemplo: tema/base, estrutura da aplicação, conversa, formulários/configurações e telas auxiliares. Não reorganizar em arquivos antes de decidir quais controles ficam na interface.

### 8. P2 — Os textos disputam o espaço que poderia orientar a ação

Evidência: descrições permanentes do papel, explicações no cabeçalho, labels longos e mensagens de estado vazio dividem atenção com o conteúdo principal.

Mudar: rótulos curtos; ajuda por campo quando necessária; estados vazios só onde uma ação pode ser tomada. Reservar textos completos para consentimento, segurança, erros e aprovação. O significado de uma ação não deve depender de um tooltip.

## Direção proposta

| Área | Padrão a adotar |
|---|---|
| Navegação | Ícones coerentes, poucos destinos principais; restante em menu |
| Agentes | Nome, descrição curta e estado relevante; sem prefixos decorativos |
| Conversa | Conteúdo como foco; cabeçalho compacto e ações secundárias por contexto |
| Compositor | Digitar, anexar, escolher modelo/raciocínio, enviar ou parar |
| Criação | Campos essenciais primeiro; perfis e rascunho por IA sob demanda |
| Configurações | Reaproveitar a navegação por categorias já existente |
| CSS | Uma regra base por componente; variações explícitas e próximas |

## Ordem de implementação

1. Definir os controles permanentes da conversa e simplificar cabeçalho/compositor juntos.
2. Limpar emojis e duplicações da lateral e dos rótulos, preservando avatares personalizados.
3. Reorganizar a criação do agente; manter modelo e raciocínio no fluxo principal.
4. Implementar a lateral compacta com acesso equivalente às funções.
5. Consolidar o CSS desses componentes e depois os estilos das telas auxiliares.
6. Conferir os mesmos fluxos em 1920 × 1080, 1440 × 900, 1366 × 768, 1280 × 720 e 900 × 600, em claro/escuro e com zoom. São critérios para a próxima implementação, não resoluções todas verificadas nesta análise.

## Acessibilidade e limites

Ícones precisam de nomes acessíveis, foco visível e áreas de clique adequadas. Estados não podem depender só de cor. Menus e seções recolhíveis devem funcionar por teclado. Remover decoração não autoriza remover avisos de segurança ou esconder o nível de raciocínio solicitado.

As capturas não comprovam conformidade completa com acessibilidade. Não foram avaliados leitores de tela, todos os diálogos, conteúdos extremos, animações e todos os fluxos do OpenBot original. O caminho de coordenador foi inspecionado no código, sem disparar uma tarefa delegada real.

Nenhuma tela foi redesenhada como parte desta análise. A conclusão é que a próxima mudança deve reduzir informações permanentes e consolidar componentes, em vez de acrescentar outra camada de sobrescritas ao CSS.
