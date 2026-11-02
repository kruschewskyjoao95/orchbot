# Orchbot — roadmap para um workspace de agentes de IA

Referência: [nightly-labs/openbot](https://github.com/nightly-labs/openbot). Pesquisa realizada em 02/11/2026.

Este é um plano de construção próprio, inspirado na experiência do OpenBot. As fases, escolhas e estimativas abaixo são recomendações para o Orchbot; não descrevem funcionalidades já implementadas. No diretório local consultado havia um `ROADMAP.md`, sem código de aplicação. Esse documento foi preservado.

## 1. Produto que vamos construir

Um aplicativo desktop no qual o usuário cria agentes com instruções e pastas de trabalho próprias, conversa com eles, acompanha tarefas e retoma o trabalho depois de fechar o aplicativo.

O OpenBot oferece agentes persistentes, vários provedores, filas locais, compartilhamento de arquivos, comunicação entre agentes e navegador integrado. Esses são os pontos de referência do produto, sem exigir paridade completa na primeira versão. [Fonte: README do OpenBot](https://github.com/nightly-labs/openbot/blob/main/README.md)

**Primeira experiência que precisa funcionar:** abrir o Orchbot, cadastrar um agente, conectar um provedor instalado, pedir uma tarefa em uma pasta escolhida, acompanhar a resposta e reabrir a conversa depois de reiniciar.

### Escopo por versão

| Versão | Entrega | Fica para depois |
|---|---|---|
| Protótipo funcional | Um agente real, resposta em streaming e histórico persistente | Filas avançadas e colaboração |
| MVP local | Vários agentes no mesmo provedor, fila durável, interrupção, anexos e pacote Linux | Segundo provedor e navegador |
| Versão 0.2 | Segundo provedor e delegação entre agentes | Acesso remoto |
| Versão 0.3 | Navegador integrado com controle supervisionado | Controle do desktop inteiro |
| Expansão | Skills/MCP, rotinas, outras plataformas e remoto conforme demanda | Marketplace e cobrança até existir necessidade |

Premissas de planejamento: desenvolvimento individual, Linux como primeira plataforma, interface inicial em português e provedor Codex como primeira integração. Validar o interesse nessas escolhas na fase 0. Não dependem de recriar o backend cloud do OpenBot.

## 2. O que aproveitar da referência

O projeto consultado usa Electron, TypeScript, SolidJS, Bun, Electron Vite, Vitest e Electron Builder. Adotar uma stack semelhante reduz diferenças em relação à referência, mas não exige copiar suas versões nem toda a estrutura de pacotes. [Fonte: package.json](https://github.com/nightly-labs/openbot/blob/main/package.json)

A arquitetura documentada separa interface, preload, processo principal e backend. Também define SQLite como fonte dos dados do aplicativo e mantém autenticação e retomada nativa sob responsabilidade dos provedores. Esse é o principal desenho a aproveitar. [Fonte: estrutura e propriedade de estado](https://github.com/nightly-labs/openbot/blob/main/docs/architecture/structure.md)

### Licença antes de reutilizar código

O arquivo `LICENSE` consultado declara **PolyForm Noncommercial 1.0.0** e indica um contato para licenciamento comercial. Antes de incorporar código ou distribuir uma derivação, verificar as condições aplicáveis ao uso pretendido. Para este roadmap, a proposta é implementação própria, com identidade visual própria e sem copiar assets. [Fonte: LICENSE](https://github.com/nightly-labs/openbot/blob/main/LICENSE)

## 3. Arquitetura inicial proposta

Começar com um único aplicativo, sem monorepo nem serviços de rede próprios:

```text
src/
  main/         Janela, ciclo de vida, validação IPC e integração com o sistema
  preload/      API restrita entre interface e processo principal
  renderer/     Interface SolidJS
  backend/
    agents/     Agentes, conversas e execução de tarefas
    providers/  Integração com o primeiro provedor
    storage/    SQLite, migrações e anexos
  shared/       Contratos e validação das mensagens entre processos
tests/          Testes das fronteiras e dos fluxos críticos
docs/           Decisões e instruções de desenvolvimento
```

Fluxo de uma solicitação:

```text
Interface → preload → IPC validado → serviço → SQLite / processo do provedor
Interface ← eventos do aplicativo ← persistência dos resultados do provedor
```

- A interface não executa comandos nem acessa arquivos diretamente.
- O backend controla a fila e a vida dos processos; a janela apenas mostra seu estado.
- Persistir mensagens e transições da tarefa antes de anunciar sua conclusão.
- Usar o SQLite do runtime Node/Electron com um driver compatível; confirmar instalação e empacotamento na fase 1. Bun fica como ferramenta de desenvolvimento, não como requisito do usuário.
- Criar uma interface de provedor pequena: conectar, iniciar/retomar sessão, enviar tarefa, interromper e emitir eventos. Só generalizar quando o segundo provedor demonstrar a necessidade.

### Dados mínimos

| Entidade | Campos e responsabilidades essenciais |
|---|---|
| Agente | ID, nome, instruções, pasta permitida, provedor e modelo |
| Conversa | ID, agente, datas e referência opcional da sessão nativa |
| Mensagem | ID, conversa, autor, conteúdo, data e estado parcial/final |
| Tarefa | ID, agente, conversa, posição na fila, estado, tentativa e erro |
| Anexo | ID, mensagem, caminho gerenciado, nome original, tamanho e hash |

Usar migrações versionadas, chaves estrangeiras e transações. Configurações simples podem ficar em uma tabela própria. Não criar memória vetorial, agenda ou entidades de equipe nesta etapa.

**Identidade do agente não é sessão do provedor:** trocar de provedor preserva a conversa local, mas não garante transferência do contexto interno. Uma nova sessão recebe um resumo explícito, sem fingir continuidade nativa.

## 4. Fases de implementação

As durações são estimativas de esforço para uma pessoa familiarizada com TypeScript, em dedicação integral. Não são compromissos; reestimar após a primeira integração real.

### Fase 0 — Fechar o recorte do produto · 1–2 dias

- [ ] Definir três tarefas reais de uso: por exemplo, analisar uma pasta, produzir um relatório e editar um projeto de teste.
- [ ] Confirmar Linux inicial, primeiro provedor, forma de autenticação e permissões disponíveis.
- [ ] Desenhar três telas simples: agentes, conversa e configurações.
- [ ] Registrar os limites do MVP e a decisão sobre reutilização de código/licença.

**Pronto quando:** existir uma sequência clara de telas para executar as três tarefas, sem depender de cloud ou mobile.

### Fase 1 — Aplicativo que abre e salva · 3–5 dias

- [ ] Inicializar Electron + TypeScript + SolidJS e comandos de desenvolvimento/build.
- [ ] Configurar preload restrito, isolamento de contexto, sandbox do renderer e validação IPC.
- [ ] Implementar SQLite e primeira migração; separar perfis de desenvolvimento e uso real.
- [ ] Criar e editar agentes, listar conversas e salvar mensagens de demonstração.
- [ ] Configurar lint, verificação de tipos e testes mínimos no CI.
- [ ] Produzir um pacote Linux preliminar para detectar cedo incompatibilidades do banco e do runtime.

**Pronto quando:** criar um agente, fechar o app, reabrir e encontrar seus dados; o pacote instalado também funciona.

**Verificação:** teste de migração/persistência e chamada IPC inválida rejeitada.

### Fase 2 — Primeira conversa real · 1–2 semanas

- [ ] Detectar a instalação do provedor e mostrar orientações quando estiver ausente ou sem autenticação.
- [ ] Integrar o Codex por sua interface oficial suportada; conferir o contrato vigente antes de implementar, sem interpretar texto visual do terminal como protocolo.
- [ ] Executar uma sessão vinculada à pasta do agente; exibir texto em streaming, ferramentas em execução e resultado final.
- [ ] Persistir a referência da sessão e permitir retomada quando suportada.
- [ ] Implementar interrupção, timeout e encerramento dos processos filhos.
- [ ] Tratar credenciais vencidas, processo encerrado, indisponibilidade de rede e limite de uso com mensagens acionáveis.
- [ ] Exibir modelo e consumo quando o provedor os informar; não inventar custo ou percentual de contexto.

**Pronto quando:** executar uma das tarefas reais, interromper outra e retomar a conversa após reiniciar o aplicativo.

**Verificação:** adapter simulado para eventos/erros e um smoke real com conta de teste. A simulação não substitui a prova de integração.

### Fase 3 — Fila durável e recuperação · 1 semana

- [ ] Permitir vários agentes, cada um com sua fila FIFO; limitar a concorrência global inicialmente.
- [ ] Persistir tarefas antes de iniciar; executar apenas uma por agente.
- [ ] Usar estados explícitos: pendente, executando, concluída, falhou, cancelada e interrompida.
- [ ] Implementar pausa da fila, retomada e cancelamento de tarefas pendentes/ativas.
- [ ] Ao iniciar o app, reconciliar tarefas que ficaram em execução e consultar a sessão nativa quando possível.
- [ ] Quando o resultado anterior for incerto, pedir retomada ou nova tentativa ao usuário, sem repetir automaticamente ações externas.
- [ ] Paginar histórico e limitar o cache em memória.

**Pronto quando:** várias mensagens mantêm a ordem e um encerramento forçado não apaga histórico nem repete silenciosamente uma execução.

**Verificação:** reinício durante uma tarefa, cancelamento seguido de evento tardio e duas solicitações simultâneas. Persistência local não garante execução externa exatamente uma vez.

### Fase 4 — Anexos, recuperação de dados e MVP instalável · 1–2 semanas

- [ ] Adicionar arquivos por seletor e exibir anexos recebidos/gerados com origem e tamanho.
- [ ] Copiar anexos para uma área gerenciada; validar caminhos reais, links simbólicos, tamanho e tipo aceito.
- [ ] Tratar falhas entre cópia e gravação no banco; limpar arquivos temporários e registrar exclusões pendentes para nova tentativa.
- [ ] Separar “remover agente do app” de “apagar pasta de trabalho”; a segunda ação exige confirmação explícita.
- [ ] Implementar exportação e restauração testada dos dados gerenciados. Informar que pastas externas e logins dos provedores não fazem parte desse backup.
- [ ] Criar instalador/pacote Linux, instruções de uso e diagnóstico sem segredos.
- [ ] Testar navegação por teclado, foco, contraste e anúncios de estado relevantes.

**Pronto quando:** uma instalação limpa executa uma tarefa com anexo, preserva os dados após reiniciar e restaura um backup em perfil separado.

**Verificação:** anexo com tentativa de escapar da pasta, falha de cópia, remoção de agente e restauração. Aqui termina o MVP local.

### Fase 5 — Segundo provedor e colaboração · 2–3 semanas

- [ ] Escolher Claude ou um agente compatível com ACP conforme os usuários iniciais.
- [ ] Adaptar apenas operações e capacidades que o segundo provedor realmente oferece.
- [ ] Permitir mensagens endereçadas entre agentes com remetente, destinatário e tarefa de origem.
- [ ] Implementar delegação explícita, retorno de resultado e transferência de anexo gerenciado.
- [ ] Limitar profundidade de delegação, número de mensagens e duração; impedir ciclos automáticos de agradecimentos.
- [ ] Ao parar uma tarefa delegada, interromper seus descendentes e mostrar o que já foi executado.

**Pronto quando:** um agente solicita uma análise a outro, recebe um arquivo e apresenta o resultado ao usuário com rastreabilidade.

**Verificação:** resposta duplicada, destinatário indisponível, limite de delegação e parada de toda a cadeia.

### Fase 6 — Navegador integrado · 2–3 semanas

- [ ] Criar uma superfície de navegador separada da interface privilegiada do app.
- [ ] Separar perfis/cookies por agente e salvar abas sem misturar credenciais.
- [ ] Expor ferramentas limitadas para abrir página, inspecionar conteúdo, clicar, preencher campos e capturar evidência.
- [ ] Permitir que o usuário assuma o controle para login e confirme ações sensíveis antes do envio.
- [ ] Bloquear navegação privilegiada, downloads inesperados e acesso a recursos locais não autorizados.
- [ ] Tratar conteúdo de páginas como entrada não confiável; instruções em páginas não concedem permissões.

**Pronto quando:** o agente consulta uma página e preenche um formulário de teste com supervisão, sem acesso da página ao preload ou ao Node.js.

**Verificação:** página adversarial, isolamento de cookies, tentativa de IPC e cancelamento durante navegação.

### Fase 7 — Expandir conforme o uso · sem prazo fechado

Priorizar uma capacidade por vez, depois de observar o MVP em uso:

1. Skills e MCP, com instalação explícita e permissões por integração.
2. Memória revisável pelo usuário e rotinas com histórico de execução, limites e prevenção de sobreposição.
3. Pacotes Windows/macOS e atualização automática com estratégia de migração e recuperação.
4. Acesso remoto autenticado, revogável e com autorização por operação; só então cliente mobile.
5. Sincronização, contas, equipes e cobrança se houver um caso de produto comprovado.

Não adicionar marketplace, Kubernetes, banco vetorial, sistema próprio de plugins ou controle completo do computador para validar o núcleo do produto.

## 5. Segurança e privacidade como critérios de entrega

As seguintes regras são propostas para o Orchbot:

- Preferir permissões restritas à pasta escolhida e aprovações quando o provedor suportar. Se ele não conseguir impor a restrição, informar a limitação e não apresentar a execução como isolada. Uma pasta própria não é uma sandbox.
- Manter banco e credenciais do aplicativo fora dos diretórios graváveis pelos agentes. Não copiar arquivos de autenticação dos provedores.
- Sanitizar Markdown/HTML, bloquear scripts em mensagens e validar origem e conteúdo de cada chamada IPC.
- Redigir tokens e dados sensíveis em logs, erros e diagnósticos; testar com um segredo fictício conhecido.
- Explicar o fluxo de dados: histórico salvo localmente pode ser enviado ao provedor durante uma tarefa. “Local-first” não significa funcionamento offline nem que nenhum conteúdo sai da máquina.

O próprio OpenBot documenta fronteiras de segurança para páginas remotas, IPC, anexos e credenciais. Há divergência entre sua política de segurança e a documentação de arquitetura sobre os modos atuais de aprovação; este plano define uma política própria e não pressupõe comportamento uniforme dos provedores. [Fontes: SECURITY.md](https://github.com/nightly-labs/openbot/blob/main/SECURITY.md) e [estrutura](https://github.com/nightly-labs/openbot/blob/main/docs/architecture/structure.md)

## 6. Estimativa, custos e pontos de decisão

| Marco | Esforço acumulado aproximado |
|---|---|
| Protótipo com conversa real | 2–3 semanas |
| MVP Linux com fila, anexos e recuperação | 4–6 semanas |
| Dois provedores e colaboração | 6–9 semanas |
| Navegador supervisionado | 8–12 semanas |

Reservar margem adicional para aprender Electron, mudanças de protocolo e falhas de empacotamento. Paridade com todo o OpenBot é outro projeto e não está incluída nessas estimativas.

Custos a acompanhar: assinatura/uso dos provedores, contas de teste e, posteriormente, assinatura de binários e infraestrutura remota. No MVP local, não há motivo para pagar por um backend próprio. Medir latência, memória, falhas e consumo informado pelo provedor antes de definir metas numéricas.

**Reavaliar após a fase 2:** se a integração não permite streaming, interrupção ou retomada confiáveis, resolver essa limitação antes de construir colaboração.

**Reavaliar após o MVP:** usar as três tarefas reais por alguns dias. Só avançar quando os problemas prioritários forem recursos ausentes, em vez de perda de dados, falhas de execução ou dificuldade de entender o estado da tarefa.

## 7. Checklist final do MVP

- [ ] Criar vários agentes no mesmo provedor, com pastas e conversas distintas.
- [ ] Enviar tarefa, acompanhar streaming e interromper execução.
- [ ] Manter a ordem da fila por agente.
- [ ] Reiniciar sem perder histórico e sem repetir automaticamente tarefas incertas.
- [ ] Enviar/receber anexos sem escapar da área gerenciada.
- [ ] Exportar e restaurar os dados do aplicativo.
- [ ] Instalar e executar em um Linux limpo com o provedor configurado.
- [ ] Identificar erros de autenticação/rede e recuperar o uso.
- [ ] Documentar permissões e envio de conteúdo aos provedores.
- [ ] Passar os testes críticos e a revisão manual de acessibilidade e segredos em diagnósticos.

## 8. Primeira execução deste roadmap

Concluir a fase 0 e implementar a fase 1. A primeira entrega deve ser um aplicativo que abre, cadastra um agente e recupera seus dados após reiniciar. Não iniciar browser, mobile ou colaboração antes de validar uma conversa real na fase 2.

Os links apontam para `main` e podem mudar. Ao iniciar a implementação, registrar o commit consultado e verificar novamente os contratos e as licenças das dependências escolhidas.
