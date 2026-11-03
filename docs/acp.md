# Conectar um agente ACP

Em **Conexões → Agente ACP**, ative a conexão e abra **⚙**. Essa conexão usa um adapter comum para executáveis que implementam [ACP v1 por stdio](https://agentclientprotocol.com/protocol/v1/transports).

1. Em **Caminho da CLI**, informe o executável instalado, pelo nome no PATH ou caminho absoluto. Não inclua argumentos nesse campo.
2. Em **Argumentos ACP**, informe uma lista JSON de textos, conforme a documentação do agente. Por exemplo, se o comando de inicialização for `meu-agente --acp`, use executável `meu-agente` e argumentos `["--acp"]`. Argumentos com espaços continuam sendo um único argumento; não há shell.
3. Faça login na CLI pelo terminal, se necessário. Para autenticar por API key, informe também a variável de ambiente esperada pelo agente, como `ANTHROPIC_API_KEY`, e salve a chave no campo protegido existente. A chave salva prevalece sobre essa variável herdada. Sem chave salva, o processo herda o ambiente do Orchbot.
4. Salve e use **Testar Conexão** para verificar o handshake ACP. Isso verifica o protocolo, sem garantir autenticação ou acesso ao modelo; falhas de autenticação ao iniciar um turno aparecem no chat.
5. Use `auto` para manter o modelo padrão do agente. **Descobrir modelos** consulta as opções de sessão da categoria `model` anunciadas pelo agente. A seleção explícita usa `session/set_config_option`; se o agente não anunciar essa opção, use `auto`.
6. Crie ou altere um robô para usar **Agente ACP**. O workspace do robô será o diretório da sessão.

Respostas chegam em streaming. Pedidos de permissão ACP abrem uma confirmação nativa com o nome do robô, a operação e as opções oferecidas pelo agente. Cancelar a confirmação não concede permissão. Interromper o turno envia `session/cancel` e encerra o processo; no Linux, também encerra subprocessos do mesmo grupo, inclusive quando iniciados por um launcher.

A conexão começa desativada para não entrar no fallback de cota sem configuração. Há uma configuração ACP por instalação, compartilhada pelos robôs que a usam. Para trocar de agente, altere comando e argumentos e retorne o modelo para `auto` ou descubra os modelos do novo agente.

O cliente não anuncia acesso a arquivos ou terminais gerenciados pelo Orchbot. Agentes que executam suas próprias ferramentas podem usá-las; agentes que exigem essas capacidades do cliente não são suportados nesta versão. Cada turno cria uma sessão nova. Instalação gerenciada, catálogo remoto de agentes, ACP v2, imagens e retomada persistente de sessão ficam fora desta etapa.
