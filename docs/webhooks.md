# Webhooks locais

Cada gatilho recebe `POST http://127.0.0.1:<porta>/t/<id>/<token>`. O endereço
completo é uma credencial: não publique o token. O corpo pode ser JSON ou texto;
o limite de entrada é 1 MiB. O payload chega ao agente como dados externos.

## Reenvios seguros

Envie o cabeçalho opcional `Idempotency-Key` com o identificador único do evento:

```http
POST /t/<id>/<token>
Content-Type: application/json
Idempotency-Key: pedido-123

{"pedido":123}
```

A chave deve ter de 1 a 200 caracteres ASCII visíveis, sem espaços, em um único
cabeçalho. Chave inválida recebe `400`, sem criar trabalho.

Durante sete dias a partir do primeiro aceite, a mesma chave no mesmo gatilho
devolve `202 {"threadId":"<conversa original>"}` sem criar conversa, mensagem ou
tarefa adicional. Reenvios não prolongam esse prazo. Chaves são sensíveis a
maiúsculas e minúsculas; a mesma chave em outro gatilho é independente.

O primeiro corpo aceito prevalece, mesmo se o reenvio trouxer outro conteúdo.
Use uma chave nova para cada evento novo. Sem cabeçalho, cada chamada cria um
trabalho, preservando o comportamento anterior; o corpo não é usado como chave.

Recibo, conversa, mensagem e tarefa são gravados na mesma transação SQLite antes
de agendar execução. Os recibos sobrevivem a reinícios. Falha de persistência
recebe `503` e permite retry com a mesma chave. Rotas, tokens ou métodos inválidos
continuam recebendo `404`; o limite de corpo também vale para reenvios.

Apagar a conversa não apaga seu recibo: um retry ainda devolve o ID original,
mesmo que a conversa já não exista. Apagar o gatilho remove seus recibos. Após
sete dias a chave pode gerar novo trabalho; recibos expirados são removidos ao
aceitar uma chamada com chave.

A garantia é deduplicar o aceite da entrega nessa janela. Ela não garante que
um agente ou serviço externo execute cada efeito uma única vez, nem autentica
o fornecedor do evento além do token local do gatilho.

Para GitHub, use a rota assinada `/github/UUID`, com repositório único e colega
Docker; essa rota não usa token na URL nem aceita bypass pela rota genérica.
[Configuração do broker e limites](control-and-runtime.md#github-configuração-e-contrato).
