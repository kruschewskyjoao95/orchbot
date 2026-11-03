---
name: depuracao-sistematica
description: Use quando algo está quebrado ou falhando e a causa não é óbvia: reproduza, isole, prove a causa e só então corrija.
---

# Depuração sistemática

1. Reproduza o problema com o menor comando possível e guarde a saída exata.
2. Formule 2-3 hipóteses e diga qual observação confirmaria ou descartaria cada uma.
3. Teste uma hipótese por vez (logs, bisect, isolar entrada). Não mude vários pontos juntos.
4. Corrija a causa raiz, não o sintoma, e adicione um teste que falhava antes.
5. Rode a suíte relevante e relate o que foi verificado.
