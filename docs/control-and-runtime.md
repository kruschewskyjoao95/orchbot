# Controle, recuperação e runtime com navegador

O primeiro broker é GitHub: evento de issue/PR → recibo → fila de um colega
Docker → resultado na conversa do Orchbot. Esta versão recebe eventos; não
publica comentários, abre issues, busca código privado nem instala GitHub Apps.
Não há catálogo de integrações ou dependência de Composio.

## Recuperação da conversa

Ao abrir/trocar a conversa e ao voltar à janela, a interface consulta mensagens,
tarefas e texto parcial do turno atual no backend. A revisão impede aplicar uma
resposta anterior aos eventos já recebidos; mensagens repetidas conservam ID e
posição. O buffer parcial existe apenas enquanto o processo principal está vivo.
Após queda do processo, valem as mensagens gravadas e a reconciliação da fila:
trabalho interrompido não é reexecutado automaticamente. Não há event sourcing
nem replay de ações externas.

## CLI e MCP de controle

Em **Configurações → Geral → Controle externo por CLI/MCP**, ative e clique
**Ver conexão** para obter o caminho de `control.json`. Desligar fecha o servidor
e remove o arquivo. Reiniciar gera outro segredo/porta. O servidor responde
somente em `127.0.0.1`, exige Bearer e rejeita `Origin` de navegador. O arquivo é
criado com modo `0600`; o cliente recusa symlink, arquivo público e URL fora do
loopback. A proteção por permissões foi verificada em Linux, não em ACLs Windows.

Quem pode ler esse arquivo pode executar tarefas com a autoridade dos agentes e
ler seus resultados. Não há ferramenta para conceder aprovações, trocar contas,
alterar permissões ou habilitar o controle. Mantenha o arquivo fora de workspaces
montados e não o entregue a clientes sem confiança.

Depois de `bun run build`, com Node compatível com o projeto:

```sh
node out/main/control.js list_agents /caminho/control.json
node out/main/control.js send_task /caminho/control.json '{"agentId":"UUID","requestId":"pedido-001","prompt":"Revise os testes"}'
node out/main/control.js get_task /caminho/control.json '{"taskId":"UUID"}'
node out/main/control.js cancel_task /caminho/control.json '{"taskId":"UUID"}'
```

No cliente MCP stdio, configure `command: "node"` e
`args: ["/caminho/out/main/control.js", "mcp", "/caminho/control.json"]`.
Alternativamente, forneça apenas o caminho por `ORCHBOT_CONTROL_FILE`.
Na distribuição Electron, o mesmo arquivo fica em `resources/app.asar/out/main/`;
use um Node externo ou o executável Electron com `ELECTRON_RUN_AS_NODE=1`.
O build de produção foi testado com Node; lançamento de AppImage não foi testado.
O diretório `chunks/` acompanha `control.js`: não copie só esse arquivo.

As quatro ferramentas têm os mesmos nomes/argumentos da CLI. `get_task` devolve
a tarefa e um snapshot da conversa, inclusive texto em andamento. Aprovações
pendentes permanecem na interface. O status de uma tarefa não representa a
conclusão de toda uma cadeia de delegações/continuações. Não há comando de espera
nem exportação de segredos. MCP usa JSONL stdio e negociação de versão; não
implementa Streamable HTTP. Mensagens de entrada são limitadas a 128 mil caracteres.

`send_task` exige `requestId`: repetições por sete dias devolvem a mesma conversa
e tarefa, inclusive após reinício ou exclusão da conversa. A mesma chave com
outro agente/prompt é recusada. Recibo, mensagem, conversa e tarefa são gravados
na mesma transação; só depois a fila pode executar. Depois da retenção, reutilizar
a chave pode criar novo trabalho. Cancelamento não desfaz efeitos já realizados.

## Container Linux com Chromium

Requer Linux **amd64**, usuário sem privilégios e Docker Engine local acessível
por socket Unix. Docker Desktop, daemon remoto, ARM, Windows e macOS não foram
validados; o runtime os bloqueia quando a plataforma/contexto é incompatível.
O app não instala nem inicia o daemon.

Compile a imagem a partir da raiz do checkout (ou da pasta `runtime` distribuída):

```sh
docker build --tag orchbot-runtime:1 --file resources/runtime/Dockerfile resources/runtime
```

O Dockerfile fixa a imagem Playwright 1.64.1 Noble pelo digest amd64
`sha256:ee15712262f017b8157421b212b12099146645f44b1bc5c0514cbbe6a229b1d0`,
Codex 0.166.0, Claude 2.1.318, Playwright MCP 0.0.84 e Playwright 1.64.1.
O MCP usa explicitamente o Chromium da imagem, pois sua dependência transitiva
usa uma versão alpha diferente. As versões diretas estão fixadas; npm ainda
resolve dependências transitivas na construção. Confie apenas em imagens que
você construiu: a label checada no lançamento não é uma assinatura da imagem.

Em **Skills e Plugins → MCP**, escolha um colega Codex/Claude e **Container Docker
com Chromium**. Configure antes uma conta com chave de API própria para essa
execução e uma pasta dedicada. Não se montam perfis de login do host. Trocar
runtime durante um turno é recusado; conversas que já receberam trabalho Docker
continuam exigindo Docker nas próximas tarefas. Abra outra conversa para voltar
a executar no host.

Cada execução nativa, incluindo manutenção de memória, cria um container novo.
Só a pasta de trabalho é montada com escrita. Raiz, home, diretórios ocultos do
home, diretórios de primeiro nível e workspaces simbólicos são recusados.
Leitura automática de regras/Git, espelho de memória e importação de skills por
caminho pelo host ficam desligados para evitar seguir symlinks fora do mount.
O CLI pode ler regras e Git dentro do container; skills podem ser propostas inline.
Não se montam `shared/`, home, perfis do browser, socket Docker nem diretórios
extras do host. Um checkout Git comum funciona nesse limite; um git worktree cujo
arquivo `.git` aponta para fora da pasta não ganha acesso ao repositório externo.
A pasta montada inteira continua acessível ao agente: não guarde segredos nela.

O processo usa UID/GID do usuário, raiz somente leitura, `cap-drop=ALL`,
`no-new-privileges`, seccomp padrão Docker, 256 PIDs, 2 GiB de memória, 2 CPUs,
`/tmp` efêmero de 512 MiB e `/dev/shm` de 256 MiB. Não publica portas. Apenas
variáveis da conta escolhida e segredos dos MCP vinculados entram no ambiente;
o ambiente completo do desktop não é repassado. A chave de API está disponível
**dentro** do container e pode ser lida por código executado ali: use conta/chave
com limite de gasto. O container não impede exfiltração pela rede.

O Playwright MCP `orchbot_browser` nasce dentro do container quando o agente tem
acesso ao navegador. O nome é reservado. Os comandos de browser/computador do
host são bloqueados, assim como mensagens de colaboração e handoff a outros
agentes. MCP HTTP explicitamente vinculado continua permitido; MCP stdio do
host é recusado. Dependências/comandos locais não são instalados automaticamente
na imagem. Sessões nativas, cookies e login do browser são descartados ao final;
o histórico do Orchbot fornece contexto ao próximo turno. Artefatos do browser
são gravados em `.playwright-mcp/` no workspace; não há visualizador/VNC novo.

**Fronteira verificada:** container, não VM. Compartilha kernel com o host. Rede
bridge tem saída para internet/LAN; não há política de egress nem promessa de
bloquear serviços do host acessíveis pela rede. Chromium roda com `--no-sandbox`:
a tentativa de habilitar seu sandbox interno falhou sob estas restrições. A
proteção é a do container; não foi demonstrada resistência a código hostil ou
exploração do kernel. Para esse requisito mais forte, use uma VM dedicada e
valide outra configuração. A recomendação upstream para navegação não confiável
é usuário separado e seccomp apropriado para o sandbox do Chromium.

No modo autônomo, Codex/Claude recebem flags que dispensam seu sandbox/diálogo
interno **dentro** do container. No cauteloso, continuam os controles nativos do
adapter. No Codex, read-only do terminal não bloqueia ações remotas por MCP nem
cliques do Playwright; não prometa aprovação independente por ação de browser.
A política MCP permanece nativa, sem proxy de autorização próprio.

Encerrar/cancelar remove o container com `docker rm --force` antes de concluir o
callback do CLI; saída normal do app tenta remover os containers ativos. Queda
abrupta do host/processo ou perda do daemon pode deixar containers. Inspecione:

```sh
docker ps -a --filter label=org.orchbot.managed=1
```

Remova pelo ID somente os containers Orchbot que identificar como abandonados
(`docker rm --force ID`). Não há limpeza indiscriminada de outros serviços.

## GitHub: configuração e contrato

1. Selecione um colega Docker com pasta já preparada; não há clone automático.
2. Em **Webhooks e automação**, preencha a instrução e `dono/repo` no campo GitHub.
3. Copie a URL `/github/UUID` e o segredo de assinatura (botão separado).
4. Na GitHub App, ative webhooks JSON, configure URL HTTPS que encaminhe para essa
   rota loopback, o segredo e subscriptions **Issues**/**Pull request**. Instale
   somente no repositório pretendido, com **Issues: read** e **Pull requests: read**.
   Não são necessárias permissões de escrita nem token GitHub no Orchbot.

O túnel/relay HTTPS é dependência externa do operador; deve preservar corpo bruto
e cabeçalhos de assinatura/entrega. Não exponha o servidor de controle `/rpc`
nesse túnel. O Orchbot não cria o túnel, cadastra a App ou usa credenciais GitHub.

A assinatura HMAC SHA-256 é comparada sobre o corpo bruto. Exige um único
`X-Hub-Signature-256`, `X-GitHub-Event` e `X-GitHub-Delivery` válido. Repositório
exato é verificado sem diferença de caixa. Aceita `issues.opened/reopened` e
`pull_request.opened/reopened/synchronize`. `ping`, outras ações e outros eventos
assinados são ignorados sem trabalho. Não acompanha `issue_comment`, reviews ou
edições; payloads acima de 1 MiB são recusados (mais restritivo que o GitHub).
O prompt inclui apenas dados selecionados do evento, limitados pelo contrato do
webhook; corpo/título externos não ganham autoridade de instrução.

A entrega usa os [recibos existentes](webhooks.md): por sete dias, a mesma
entrega/gatilho não cria outro trabalho. Responde `202` com `threadId` após gravar,
sem esperar o modelo. Assinatura inválida: `401`; payload/repositório inválido:
`400`; destino que deixou de ser Docker: `409`; falha transacional: `503` para
retry. O resultado fica no Orchbot/controle local, não no GitHub. A assinatura
confirma origem/integridade, não que o texto da issue seja confiável.

## Routing medido em português

**Configurações → Geral → Routing automático nos canais** é opt-in. Só escolhe
entre participantes atuais. Uma @menção exata e única tem prioridade. Sem menção,
exige ao menos dois termos exclusivos do nome/descrição de um único colega e
nenhum sinal de outro. Normaliza caixa/acentos; dúvida, menção desconhecida ou
múltipla mantém o dono. O dono não muda; a decisão fica no log do canal.
GitHub continua com destino fixo no gatilho, sem classificar eventos por modelo.

Corpus local manual: 24 frases em português, incluindo ambiguidade, ausência de
sinal, mistura de assuntos, caixa/acentos e menções. Resultado: 24/24 destinos
esperados; 13/24 encaminhados a especialista e 11 mantidos no dono. Não é corpus
independente nem medição em produção. Não mede sinônimos, semântica, custo ou
qualidade de LLM, e não autoriza troca automática de engine/modelo. Ampliar esse
routing exige exemplos reais e avaliação separada; descrições genéricas tendem
a manter o dono.

## Validação reproduzível e fontes

```sh
bun run typecheck
bun run build
ORCHBOT_TEST_DOCKER=1 ORCHBOT_TEST_BUILT_CONTROL=1 bun run test -- --maxWorkers=2
```

Regressões: transação/retry/reabertura, autenticação e arquivo privado, protocolo
MCP e CLI compilada consumindo servidor real, snapshot durante streaming,
assinatura/repositório/GitHub sem fallback host, bloqueio de acessos ao host,
políticas/sessões Docker, corpus e integração do routing no canal. Os testes
Docker reais usam página HTTP criada dentro do próprio container, sentinela fora
do mount, UID/capabilities, filesystem e cancelamento. Não usam credenciais reais.

Verificado neste Linux amd64 com Docker 29.9.2: build da imagem, CLIs `--version`,
Playwright MCP real, navegação local e remoção de processos/containers. Não houve
turno pago com modelo real, conexão a GitHub App/túnel externo, publicação externa,
teste visual da UI, pentest, validação de AppImage ou matriz de outros hosts.

Fontes primárias:

- [GitHub Apps: webhooks](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/using-webhooks-with-github-apps)
- [GitHub Apps: permissões](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/choosing-permissions-for-a-github-app)
- [GitHub: cabeçalhos, eventos e payloads](https://docs.github.com/en/webhooks/webhook-events-and-payloads)
- [Playwright Docker e sandbox Chromium](https://playwright.dev/docs/docker)
- [Docker Engine: fronteiras de segurança](https://docs.docker.com/engine/security/)
- [MCP stdio](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports)
- [MCP tools](https://modelcontextprotocol.io/specification/2025-11-25/server/tools)
- Código e testes deste checkout: `src/backend/runtime/docker.ts`,
  `src/backend/control/`, `src/control/`, `src/backend/triggers/github.ts`,
  `src/backend/collaboration/routing.ts` e `tests/*{control-recovery,docker-runtime,docker-queue,github-broker,routing-portuguese,channel-routing}*`.

Para rollback a uma versão anterior, cancele e confirme a parada dos trabalhos
Docker antes de abrir o banco antigo. Versões anteriores ignoram `runtime` e
`required_runtime` e poderiam executar pendências no host. As migrações são
aditivas, mas essa restrição de segurança não existe nos binários anteriores.
