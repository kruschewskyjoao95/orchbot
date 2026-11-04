# Validação da interface e dos seletores de modelo

Escopo confirmado: reproduzir a linguagem visual do OpenBot nas telas atuais do Orchbot, mantendo seus recursos e sua organização; descobrir modelos e níveis de raciocínio da conta selecionada.

## Referências e evidências

- Referência fornecida: `/home/joao/Documents/Craft Anything/openbot-0-53-2-x86-64`, incluindo `app/MECHANICS.md` e o CSS do renderer extraído.
- [Comparação no mesmo viewport](docs/design/openbot-comparison.png): referência à esquerda e Orchbot à direita, cada um com 941 × 508 pixels/CSS pixels e densidade 1, sem redimensionamento. A imagem de referência foi capturada pelo modo `--screenshot` da reprodução Rust fornecida; não é uma captura do aplicativo OpenBot original.
- [Conversa escura](docs/design/chat-dark.png): 1240 × 850.
- [Configurações claras](docs/design/settings-light.png): 1240 × 850.
- [Modelo e raciocínio na criação do agente](docs/design/model-and-effort.png): 1240 × 850, capturada após a integração dos novos seletores.
- As três primeiras capturas documentam a etapa visual; a última documenta o fluxo final de seleção de modelo e raciocínio.
- Verificações executadas no Electron/Chromium com perfil e mensagens de demonstração em `/tmp/orchbot-design-preview/profile`, separado dos dados do usuário.

## Superfícies verificadas

- **Tipografia:** Inter Variable local, com licença SIL OFL incluída na distribuição; carregamento confirmado por `document.fonts`. Código mantém fonte monoespaçada. A reprodução Rust tem outra renderização de texto; a fonte do renderer original é a referência tipográfica.
- **Espaçamento e layout:** barra de ícones de 52 px, lateral de 280 px (220 px em 900 px), avatares circulares de 36 px, bolhas com raio de 22 px e preenchimento de 8 × 12 px; coluna de conversa de até 760 px.
- **Cores:** canvas/lateral #1a1a1a, superfície #212121, seleção #2a2a2a, texto principal branco e secundário #dcdcdc. Tema claro e temas personalizados continuam disponíveis. Iniciais usam texto escuro para manter contraste nos avatares pastel configurados no Orchbot.
- **Recursos visuais:** preservados marca, ícones existentes e cores dos agentes do Orchbot. Não foram importados bundles executáveis ou dependências do outro aplicativo.
- **Conteúdo:** textos em português; rótulos do compositor mais curtos com nomes acessíveis. As mensagens em inglês nas capturas são dados de demonstração.

## Ajustes após comparação

1. Cabeçalho ocupava duas linhas mesmo com espaço disponível: ações movidas para a mesma linha acima de 1100 px; segunda linha preservada em janelas menores.
2. Busca avançava sobre o cabeçalho em 900 px: aplicado `min-width: 0` no contêiner flexível e conferida nova captura.
3. Contraste dos avatares: mantidas iniciais escuras nas cores pastel existentes; capturas recapturadas após o ajuste.
4. Campo de modelo filtrava sugestões pelo texto preenchido: substituído por seletor da lista inteira, mantendo entrada manual de IDs.
5. Raciocínio ficava dentro de “Avançado” na criação: movido para logo abaixo do modelo e verificado no Electron.

Diferenças intencionais: marca Orchbot, nomes/descrições na lateral, barra de assuntos, controles de autonomia/raciocínio, atalhos de equipe e ações de delegação permanecem nas telas atuais. Esses controles ocupam mais altura que a referência em 941 × 508; a conversa permanece rolável e o compositor acessível.

## Interações e validação

- Seleção de agente, digitação, menções, alternância entre conversa e navegador, configurações e troca entre temas claro e escuro.
- Sem overflow horizontal em 1240 px; busca corrigida em 900 px.
- No Electron, Astra ofereceu `low`, `medium`, `high`, `xhigh`, `max` e `ultra`; Luna ofereceu os mesmos níveis sem `ultra`.
- O seletor de raciocínio da criação ficou fora de `details` e foi atualizado ao mudar o modelo.
- Consultas reais aos CLIs retornaram os modelos e as capacidades de Codex e Claude sem enviar prompts de trabalho.
- Testes cobrem perfil selecionado, paginação, cache do perfil, fallback explícito, capacidades por modelo, nomes futuros válidos de esforço, persistência e envio de `ultra` ao CLI.
- Console: aviso de CSP do Electron em desenvolvimento, já existente; sem exceções observadas nas interações.
- Verificação final: 428 testes passaram, 1 ignorado; typecheck, lint e build passaram.

Não verificados: tarefas reais nos provedores, instaladores, todos os diálogos secundários e interface abaixo do tamanho mínimo de janela do aplicativo.

final result: passed
