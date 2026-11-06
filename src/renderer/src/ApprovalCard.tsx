import { For, Show, createSignal } from 'solid-js'
import type { Agent, Approval } from '../../shared/types'
import { approvalReceipt } from './approval-card'

export function ApprovalCard(props: {
  approval: Approval
  agents: Agent[]
  onDecide: (approval: Approval, approved: boolean, note?: string) => void
}) {
  const [freeText, setFreeText] = createSignal('')
  const pending = () => props.approval.status === 'pending'
  const isQuestion = () => props.approval.kind === 'question'
  const agentName = () =>
    props.agents.find((agent) => agent.id === props.approval.agentId)?.name ?? 'Um agente'
  const options = () => props.approval.options ?? []

  return (
    <div
      class="approval-card"
      classList={{ settled: !pending(), question: isQuestion() }}
      data-approval-id={props.approval.id}
    >
      <Show
        when={pending()}
        fallback={<div class="approval-card-receipt">{approvalReceipt(props.approval)}</div>}
      >
        <strong>
          {isQuestion() ? `${agentName()} pergunta` : `${agentName()} pede sua aprovação`}
        </strong>
        <div class="approval-card-text">{props.approval.text}</div>
        <Show when={isQuestion() && options().length > 0}>
          <div class="approval-card-actions">
            <For each={options()}>
              {(option) => (
                <button
                  type="button"
                  class="btn-primary"
                  onClick={() => props.onDecide(props.approval, true, option)}
                >
                  {option}
                </button>
              )}
            </For>
          </div>
        </Show>
        <Show when={isQuestion()}>
          <div class="approval-card-free">
            <input
              type="text"
              value={freeText()}
              placeholder={options().length > 0 ? 'Outra resposta' : 'Sua resposta'}
              onInput={(e) => setFreeText(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key !== 'Enter') return
                e.preventDefault()
                const note = freeText().trim()
                if (note) props.onDecide(props.approval, true, note)
              }}
            />
            <button
              type="button"
              class="btn-primary"
              disabled={!freeText().trim()}
              onClick={() => {
                const note = freeText().trim()
                if (note) props.onDecide(props.approval, true, note)
              }}
            >
              Enviar
            </button>
            <button
              type="button"
              class="btn-secondary"
              onClick={() => props.onDecide(props.approval, false)}
            >
              Pular
            </button>
          </div>
        </Show>
        <Show when={!isQuestion()}>
          <div class="approval-card-actions">
            <button
              type="button"
              class="btn-primary"
              onClick={() => props.onDecide(props.approval, true)}
            >
              Aprovar
            </button>
            <button
              type="button"
              class="btn-secondary"
              onClick={() => props.onDecide(props.approval, false)}
            >
              Recusar
            </button>
          </div>
        </Show>
      </Show>
    </div>
  )
}
