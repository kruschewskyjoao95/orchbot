---
name: revisao-de-codigo
description: Use ao revisar código, diffs ou pull requests: procura bugs, riscos de segurança e falta de testes.
---

# Revisão de código

1. Leia o diff inteiro e os arquivos ao redor antes de comentar.
2. Procure, nesta ordem: bugs de lógica, segurança (injeção, segredos, validação), tratamento de erro, concorrência, desempenho em caminhos quentes.
3. Verifique se há testes para o comportamento novo e para os casos de borda.
4. Responda com uma lista priorizada: **Bloqueia** / **Deveria corrigir** / **Sugestão**. Cada item cita arquivo e linha e explica o impacto em uma frase.
5. Diga explicitamente o que você NÃO conseguiu verificar.
