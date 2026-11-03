# Várias contas por provedor

Em **Conexões → Contas**, adicione uma conta com nome e API key própria. As chaves usam o mesmo cofre do Electron das conexões existentes e nunca são devolvidas à tela. O endpoint e as opções de execução continuam pertencendo ao provedor; para endpoints diferentes, cadastre provedores customizados separados.

A conexão existente aparece como **Padrão**, preservando chave, login e sessões anteriores. Ela pode ser desativada sem desligar o provedor inteiro. A opção **Automática** do robô escolhe a primeira conta habilitada, começando por Padrão. Também é possível selecionar uma conta específica ao criar ou editar o robô.

## Login com assinatura no CLI

Codex e Claude aceitam contas com **Login em perfil CLI separado**. Informe um diretório absoluto exclusivo, salve e execute no terminal o comando exibido para fazer login nesse perfil. O app não abre nem conclui o login automaticamente.

- Codex recebe `CODEX_HOME` e `CODEX_SQLITE_HOME` apontando para esse diretório.
- Claude recebe `CLAUDE_CONFIG_DIR` apontando para esse diretório.
- Contas adicionais com API key nesses dois CLIs recebem diretórios gerenciados na pasta `accounts`, ao lado do banco do app.

As contas adicionais removem as credenciais de ambiente reconhecidas antes de aplicar sua própria autenticação. Os perfis precisam ter suas próprias configurações e permissões do CLI. Use diretórios diferentes do perfil global e dos demais perfis; não copie arquivos de login entre contas.

Referências: [variáveis de ambiente do Codex](https://learn.chatgpt.com/docs/config-file/environment-variables) e [configurações do Claude Code](https://code.claude.com/docs/en/settings).

Para outros provedores, esta versão oferece contas por API key. No ACP, configure na conexão o nome da variável que recebe a chave. **Testar conta** usa a checagem de autenticação disponível no adapter: um estado não verificado não confirma que a chave tem saldo ou acesso ao modelo.

## Fallback e sessões

Ao receber um erro de cota ou limite, a fila tenta as demais contas habilitadas do mesmo provedor, na ordem de cadastro. Depois tenta contas de outros provedores habilitados. Cada conta é tentada no máximo uma vez por tarefa; erros comuns de autenticação não provocam rotação.

A troca dentro do mesmo provedor mantém o modelo do robô. A troca de provedor usa o modelo padrão do destino. A conta escolhida pelo fallback fica selecionada no robô para os próximos turnos. Não há cooldown automático nem retorno automático à conta anterior.

Trocar de conta inicia uma nova sessão nativa com o histórico local disponível; uma sessão nativa nunca é retomada em outra conta. Mantendo a conta, Codex e Claude continuam retomando a sessão após reiniciar o app. As mensagens locais são preservadas.

## Alterações e remoção

Uma conta selecionada explicitamente que tenha sido desativada causa erro claro; o app não usa silenciosamente o login global. Remover uma API key desativa a conta até que outra chave seja salva e a conta habilitada novamente.

Contas usadas por robôs não podem ser removidas sem antes trocar a seleção. Remover uma conta apaga seu cadastro e a chave salva, mas mantém arquivos e logins de CLI no disco. A conta Padrão pode ser desativada, mas não removida.

## Validação

Os testes cobrem migração de banco antigo, persistência criptografada, isolamento de variáveis e perfis, fallback HTTP local e continuidade de sessões usando CLIs simulados. Não substituem a validação com duas contas autenticadas nos serviços reais.
