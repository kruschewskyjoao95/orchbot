# Provedores personalizados

Em **Conexões → + Provedor personalizado**, escolha um atalho ou **OpenAI-compatible** e informe nome, URL base, modelo e API key. O cadastro aparece como uma conexão própria e pode ser selecionado ao criar um robô ou trocar o provedor de um robô existente. Vários cadastros podem usar endpoints diferentes, inclusive do mesmo serviço.

Os atalhos preenchem:

| Serviço | URL base | Modelo inicial |
| --- | --- | --- |
| Ollama local | `http://localhost:11434/v1` | Informe um modelo instalado no seu Ollama |
| OpenRouter | `https://openrouter.ai/api/v1` | `openrouter/auto` |
| DeepSeek | `https://api.deepseek.com` | `deepseek-flash` |

Os valores seguem a documentação de [Ollama](https://docs.ollama.com/api/openai-compatibility), [OpenRouter](https://openrouter.ai/docs/guides/routing/routers/auto-router) e [DeepSeek](https://api-docs.deepseek.com/). Nome, URL e modelo podem ser alterados. A troca de atalho limpa a chave digitada para evitar enviá-la a outro serviço.

Informe a URL base com o prefixo exigido pelo servidor, como `/v1` ou `/api/v1`, sem acrescentar `/chat/completions`. Use o ID exato do modelo. Depois de salvar, o botão **⚙ → Descobrir modelos** consulta `GET /models`; você também pode digitar o ID diretamente. **Testar conexão** verifica esse endpoint sem gerar uma resposta paga. Alguns serviços publicam a lista de modelos sem autenticação: o teste não garante que a chave tenha permissão ou saldo para gerar respostas.

As chaves usam o cofre seguro do sistema já integrado ao Orchbot. Não voltam para a tela. Sem chaveiro disponível, é possível cadastrar APIs locais sem chave, mas não salvar novas chaves. Quando uma chave está salva, mudar a origem da URL (protocolo, host ou porta) exige informar uma nova chave ou remover a antiga no mesmo salvamento. URLs não aceitam credenciais, parâmetros ou fragmentos; requisições não seguem redirects.

Cada turno envia instruções/contexto e a mensagem ao endpoint cadastrado por `POST /chat/completions`, com `stream: true`. O cliente recebe SSE e também aceita servidores que retornam JSON. Interromper o turno aborta a requisição. Erros HTTP ou de streaming aparecem no chat; erros de cota continuam usando o fallback existente entre conexões habilitadas.

Esta integração oferece chat de texto e os protocolos textuais do Orchbot. Não anuncia ferramentas nativas da API, não envia imagens e não executa automaticamente chamadas `tool_calls` retornadas pelo servidor. A geração tem limite de cinco minutos por requisição. Autenticação usa `Authorization: Bearer`; APIs que exigem outro protocolo precisam de um adapter específico.

Use **⚙** para editar ou remover. A remoção é bloqueada enquanto algum robô usar esse provedor; altere esses robôs primeiro. Os provedores personalizados não recebem sugestões de atualização de CLI/npm.
