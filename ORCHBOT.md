# Diretrizes e Arquitetura do Orchbot

Este documento define as regras fundamentais de arquitetura, padrões de estilo e preferências de desenvolvimento que devem ser sempre respeitadas no repositório.

## 1. Princípios de Arquitetura
- **Local-First & Privacidade**: Toda a persistência é feita localmente no SQLite (`node:sqlite`) com WAL e integridade referencial (`PRAGMA foreign_keys = ON;`).
- **Execução FIFO Durável**: Tarefas enviadas ao bot passam pela fila durável (`task_queue`) e sobrevivem a reinicializações com reconciliação automática.
- **Provider-Agnostic**: O sistema suporta Codex, Claude, Grok e Muse de forma intercambiável, permitindo troca dinâmica mesmo no meio de uma conversa.
- **Isolamento de Conversas**: Múltiplas threads por agente isolam contexto, tópicos de pesquisa, depuração e planejamento sem misturar histórico.

## 2. Padrões de Código e Qualidade
- **TypeScript Estrito**: Tipagem precisa em `src/shared/types.ts`. Sem casts inseguros (`any`) ou non-null assertions arbitrárias.
- **Linter & Formatter**: Biome (`bun run lint`). Todo o código submetido deve passar limpo sem avisos ou erros.
- **Testes Unitários**: Vitest (`bun run test`). Toda nova feature deve conter testes em `tests/`.
- **Interface Reativa**: SolidJS no frontend renderizado com Electron, componentes leves e modularizados.
q