# Antigravity

O Orchbot conecta o Antigravity por **ACP (stdio)** com o servidor `agy_acp_server`, igual a OpenBot e Paseo.
Os comandos `antigravity` (o IDE gráfico) e `agy` (CLI interativa) **não** são esse servidor: o Orchbot nunca os executa.

## Onde ele procura o servidor (nesta ordem)

1. Caminho explícito em **Conexões → Antigravity → ⚙** (um caminho que seja `antigravity` ou `agy` é ignorado).
2. Variável `ORCHBOT_ANTIGRAVITY_PATH`.
3. `~/.local/share/antigravity-acp/wrapper/agy_acp_server.par`.
4. A versão mais nova em `~/.local/share/antigravity-acp/<versão>/agy_acp_server.par`.
5. O runtime gerenciado do OpenBot, somente leitura: `~/.config/OpenBot/provider-runtimes/antigravity/<plataforma>/<versão>/bin/`.

Só os caminhos de Linux são pesquisados; em macOS/Windows informe o caminho explicitamente. O Orchbot não baixa o servidor (a licença do Google não permite redistribuição).

## Detalhes do protocolo

- Modelos vêm do `session/new` (`gemini-4-argon`, `gemini-3.8-flash`, `claude-opus-5-5`…). O esforço do robô vira a opção `thinking_level`, se o valor existir.
- O Orchbot se apresenta como cliente `zed` no `initialize`: é o nome que o servidor reconhece para liberar os modelos Claude/GPT.
- O servidor aceita MCP por stdio, HTTP e SSE.
- O login é a sessão Google já salva em `~/.gemini/antigravity-acp`. O Orchbot **não** abre o fluxo de login: entre pelo Antigravity/OpenBot/T3 Code antes.

## `RLIMIT_RTTIME` (o servidor "morre sozinho")

Apps abertos por outro Electron (T3 Code, por exemplo) herdam `RLIMIT_RTTIME` limitado, e o servidor se mata com SIGKILL ao iniciar. Quando o limite herdado é restritivo, o Orchbot lança o servidor por `systemd-run --user` com `LimitRTTIME=infinity` e **para a unidade explicitamente** ao fim do turno (encerrar o cliente do `systemd-run` não para o serviço). Scripts (como o wrapper acima) já fazem isso e rodam direto. `ORCHBOT_NO_RTTIME_GUARD=1` desliga o desvio.
