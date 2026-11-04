import { For, type JSX, Show, createSignal } from 'solid-js'

/** O select mostra a lista inteira; IDs fora do catálogo continuam editáveis. */
export function ModelPicker(props: {
  id?: string
  class?: string
  style?: JSX.CSSProperties
  disabled?: boolean
  message?: string
  value: string
  models: string[]
  onChange: (value: string) => void
  onRefresh?: () => Promise<void>
}) {
  const [custom, setCustom] = createSignal(false)
  const [refreshing, setRefreshing] = createSignal(false)
  return (
    <div class="model-picker">
      <select
        id={props.id}
        class={props.class}
        style={props.style}
        aria-label="Modelo"
        value={!custom() && props.models.includes(props.value) ? props.value : ''}
        disabled={props.disabled}
        onChange={(event) => {
          const value = event.currentTarget.value
          setCustom(value === '')
          if (value) props.onChange(value)
        }}
      >
        <option value="">Outro modelo (informar ID)…</option>
        <For each={props.models}>{(model) => <option value={model}>{model}</option>}</For>
      </select>
      <Show when={custom() || !props.models.includes(props.value)}>
        <input
          class={props.class}
          style={props.style}
          aria-label="ID personalizado do modelo"
          placeholder="ID do modelo"
          value={props.value}
          disabled={props.disabled}
          onChange={(event) => {
            const value = event.currentTarget.value.trim()
            if (value) props.onChange(value)
          }}
          required
        />
      </Show>
      <Show when={props.onRefresh}>
        <button
          type="button"
          class="btn-outline"
          disabled={refreshing() || props.disabled}
          aria-label="Atualizar lista de modelos"
          onClick={async () => {
            setRefreshing(true)
            try {
              await props.onRefresh?.()
            } finally {
              setRefreshing(false)
            }
          }}
        >
          {refreshing() ? 'Atualizando…' : 'Atualizar'}
        </button>
      </Show>
      <Show when={props.message}>
        <small class="model-picker-message">{props.message}</small>
      </Show>
    </div>
  )
}
