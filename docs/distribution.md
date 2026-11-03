# Distribuição

## Empacotar

| Alvo | Comando | Onde roda |
| --- | --- | --- |
| Linux (AppImage, deb) | `bun run package:appimage` / `package:deb` | Linux |
| macOS (dmg, zip) | `bun run package:dmg` | **macOS** (o dmg só é gerado lá) |
| Windows (instalador NSIS) | `bun run package:exe` | Windows (ou Linux com Wine) |

Os alvos de macOS e Windows estão configurados em `electron-builder.json`, mas só o alvo Linux foi gerado e conferido neste repositório.

O build leva junto: skills do catálogo (`resources/skills` → `skills/`) e o ícone (`icon.png`).

## Atualização automática do Orchbot

Usa `electron-updater` com um **feed genérico em HTTPS que você hospeda** (nenhum serviço de terceiros embutido).

1. Gere os artefatos e os arquivos de feed (`latest.yml`, `latest-linux.yml`, `latest-mac.yml`):

   ```
   bun run build && electron-builder --publish never --config electron-builder.json \
     -c.publish.provider=generic -c.publish.url=https://seu-host/orchbot
   ```

2. Publique o conteúdo de `dist/` nessa URL.
3. No app: **Configurações → Geral → Atualizações e diagnóstico**, informe o endereço e ligue a opção.

Só funciona no app instalado. No Linux, atualiza AppImage (pacote `.deb` não se atualiza sozinho). Aceita apenas HTTPS (ou `http://localhost` para testes).

## Link `orchbot://`

O app registra o protocolo e roda em instância única. Destinos aceitos (qualquer outro é ignorado):

- `orchbot://agent/<id>` · `orchbot://channel/<id>` · `orchbot://new-agent`
- `orchbot://agents` · `orchbot://channels` · `orchbot://skills` · `orchbot://connections`

O link só navega pela interface; não executa ações.

## CLIs instalados pelo app

Em **Conexões → ⚙ do provedor → CLI gerenciado**, o app instala o CLI numa pasta própria (`userData/cli/<provedor>`) com `npm install --prefix`, sem sudo e sem tocar no npm global. Requer Node.js/npm na máquina.

- **Fixar versão:** com a versão fixada, o app não sugere nem aplica atualizações até você soltar a versão.
- O caminho instalado vale quando você não definiu um caminho próprio do CLI.
- Instaláveis: os que têm pacote npm (Codex, Claude, Gemini, OpenCode, Copilot, Kimi, Pi).

### Atualização de CLIs fora do npm

| CLI | Como atualiza |
| --- | --- |
| Grok | `grok update` (checagem por `grok update --check --json`) |
| Pi | `pi update --self` (versão mais recente via npm) |
| Muse | sem comando de atualização conhecido: reinstale pelo método original |
| Antigravity | sem canal próprio: o servidor ACP (`agy_acp_server`) é atualizado pelo app que o instalou (T3 Code, OpenBot…) |

## Temas

Arquivos `.json` em `userData/themes/` (botão **Abrir pasta**) e temas do Omarchy em `~/.config/omarchy/themes/<nome>/colors.toml` aparecem em **Configurações → Geral → Temas** e são recarregados ao vivo.

```json
{
  "name": "Meu tema",
  "mode": "dark",
  "colors": { "background": "#151718", "foreground": "#d8d0b8", "accent": "#e36b2c" },
  "vars": { "--bg-card": "#252827" }
}
```

`colors` usa os nomes do Omarchy; `vars` sobrescreve variáveis CSS individuais (só valores de cor/sombra simples; `url()` e `;` são rejeitados).

## Primeiro uso e diagnóstico

- Na primeira abertura o app exige o aceite do aviso de riscos. **Até aceitar, nenhum agente executa** (as tarefas ficam pendentes). Mudar `CONSENT_VERSION` exige novo aceite.
- **Exportar diagnóstico** grava um JSON só com versões, contagens, estados e erros recentes redigidos: nunca mensagens, instruções, nomes de agentes, chaves, variáveis de MCP, endereços de provedores ou sua pasta pessoal.

## Servidores de modelos locais

Em **Conexões**, o app procura Ollama (`127.0.0.1:11434`) e LM Studio (`127.0.0.1:1234`) e oferece adicioná-los como provedor OpenAI-compatível. A busca é só em loopback.
