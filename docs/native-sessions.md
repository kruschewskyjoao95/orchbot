# Continuidade de sessões de Codex e Claude

As conexões nativas de Codex e Claude retomam a sessão do CLI automaticamente nos turnos seguintes da mesma conversa. O Orchbot captura o UUID informado pelo CLI e o salva no SQLite assim que ele chega, antes de o turno terminar. O vínculo sobrevive ao reinício do app, inclusive quando uma tarefa interrompida é reconciliada na próxima abertura.

O processo do CLI continua sendo iniciado por turno; a continuidade vem do histórico nativo salvo pelo próprio CLI. O banco do Orchbot guarda o ID e o escopo da conexão, não uma cópia dos arquivos internos de sessão. Esses arquivos precisam continuar disponíveis na máquina para retomar o contexto fino.

- Codex usa `codex exec resume <ID> <prompt>` e captura o evento `thread.started` de `--json`, conforme a [documentação oficial](https://developers.openai.com/codex/noninteractive).
- Claude usa `claude -p --resume <ID>` e captura `session_id` dos eventos de inicialização/resultado, conforme a [documentação oficial](https://code.claude.com/docs/en/headless#continue-conversations).

O Orchbot passa sempre o UUID exato. Não usa `--last` ou `--continue`, que poderiam escolher uma conversa diferente em máquinas com vários agentes. Cada conversa tem um vínculo independente; alternar entre abas retoma a sessão daquela conversa.

Uma conversa nova começa outra sessão. Alterar o provedor ou workspace do robô invalida os vínculos das conversas dele. Alterar o executável, endpoint ou a API key salva da conexão também impede reutilizar o vínculo anterior. O escopo usa um hash; não grava a chave em texto puro. Alterar modelo ou esforço mantém a sessão. Após mudar o login do CLI fora do Orchbot, use **Reiniciar sessão CLI** para iniciar outro contexto de forma explícita.

Quando começa uma sessão sem vínculo, o Orchbot fornece um resumo do histórico local anterior, conforme o modo de contexto do robô. Ao retomar uma sessão existente, não reinjeta esse resumo: o CLI já tem seu histórico. As instruções atuais do robô, diretrizes e capacidades continuam sendo enviadas. O modo de contexto controla o resumo inicial; retenção e compactação da sessão nativa são responsabilidade do CLI.

**Interromper** envia um sinal de encerramento ao processo e aguarda sua saída antes de liberar o próximo turno da fila. O ID capturado é preservado para retomar depois. Cancelar uma tarefa pendente não libera indevidamente uma sessão ainda em execução. No fechamento normal do app, as execuções ativas são interrompidas; tarefas que estavam em execução são reconciliadas na próxima abertura.

Se o CLI não encontrar mais a sessão, retornar outro ID ou falhar depois de produzir uma resposta parcial, o turno aparece como falha. O Orchbot não repete automaticamente o pedido em uma sessão nova: o CLI pode já ter executado ações. Você pode usar **Reiniciar sessão CLI** na barra do robô ou abrir outra conversa. O botão remove apenas o vínculo no Orchbot, preserva as mensagens e exige que o turno ativo já tenha encerrado. A próxima mensagem começa uma sessão nova com resumo local. Repetir uma tarefa deve considerar o que o CLI já executou.

Esta etapa cobre apenas os adapters nativos de Codex e Claude. ACP e APIs OpenAI-compatible mantêm o comportamento documentado em suas integrações.

No runtime Docker, cada execução é descartável: não se salva/retoma sessão nativa.
A continuidade vem do histórico local do Orchbot. [Runtime e limites](control-and-runtime.md).
