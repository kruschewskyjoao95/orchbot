import { type Component, For, Show, createSignal, onMount } from 'solid-js'
import type { BrainPage, BrainPageType, BrainProposal, Project } from '../../shared/types'

const TYPES: { id: BrainPageType; label: string }[] = [
  { id: 'company', label: 'Empresa' },
  { id: 'product', label: 'Produto' },
  { id: 'note', label: 'Nota' },
]

/** Wiki do projeto: a pessoa grava; as propostas dos colegas esperam aceite. */
export const BrainPanel: Component<{ project: Project; onClose: () => void }> = (props) => {
  const [pages, setPages] = createSignal<BrainPage[]>([])
  const [proposals, setProposals] = createSignal<BrainProposal[]>([])
  const [editingSlug, setEditingSlug] = createSignal<string | null>(null)
  const [title, setTitle] = createSignal('')
  const [type, setType] = createSignal<BrainPageType>('note')
  const [content, setContent] = createSignal('')
  const [error, setError] = createSignal<string | null>(null)
  const [busy, setBusy] = createSignal(false)

  const load = async () => {
    if (!window.orchbot) return
    const [nextPages, nextProposals] = await Promise.all([
      window.orchbot.listBrainPages(props.project.id),
      window.orchbot.listBrainProposals(props.project.id),
    ])
    setPages(nextPages)
    setProposals(nextProposals)
  }

  onMount(() => {
    void load().catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
  })

  const openPage = (page: BrainPage | null) => {
    setError(null)
    if (!page) {
      setEditingSlug(null)
      setTitle('')
      setType('note')
      setContent('')
      return
    }
    setEditingSlug(page.slug)
    setTitle(page.title)
    setType(page.type)
    setContent(page.content)
  }

  const save = async () => {
    if (!window.orchbot) return
    setBusy(true)
    setError(null)
    try {
      const saved = await window.orchbot.saveBrainPage({
        projectId: props.project.id,
        slug: editingSlug() ?? undefined,
        title: title(),
        type: type(),
        content: content(),
        replace: editingSlug() !== null,
      })
      await load()
      openPage(saved)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    const slug = editingSlug()
    if (!slug || !window.orchbot) return
    if (!confirm(`Apagar a página "${title() || slug}"?`)) return
    setBusy(true)
    setError(null)
    try {
      await window.orchbot.deleteBrainPage(props.project.id, slug)
      await load()
      openPage(null)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const decide = async (proposal: BrainProposal, accept: boolean) => {
    if (!window.orchbot) return
    setBusy(true)
    setError(null)
    try {
      await window.orchbot.decideBrainProposal(proposal.id, accept)
      await load()
      if (accept) {
        const page = pages().find((item) => item.slug === proposal.slug) ?? null
        if (page) openPage(page)
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <dialog
      class="modal-overlay"
      open
      aria-label={`Cérebro de ${props.project.name}`}
      onClick={(e) => e.target === e.currentTarget && props.onClose()}
      onKeyDown={(e) => e.key === 'Escape' && e.target === e.currentTarget && props.onClose()}
    >
      <div
        class="modal-content brain-modal"
        role="document"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <div class="modal-header">
          <span class="modal-title">🧠 Cérebro · {props.project.name}</span>
          <button
            type="button"
            class="modal-close"
            onClick={() => props.onClose()}
            aria-label="Fechar"
          >
            ✕
          </button>
        </div>
        <div class="brain-layout">
          <p class="brain-help">
            O que a empresa vende, para quem, o tom e os preços ficam aqui, à vista de todos os
            robôs do projeto. Um colega propõe; você ou o líder grava. Um título com{' '}
            <code>{'<!-- não confirmado -->'}</code> ainda não foi confirmado.
          </p>
          <Show when={proposals().length > 0}>
            <div class="brain-proposals">
              <strong>Propostas dos colegas</strong>
              <For each={proposals()}>
                {(proposal) => (
                  <article class="brain-proposal">
                    <header>
                      <strong>{proposal.title}</strong>
                      <span>
                        {proposal.slug}
                        {proposal.unconfirmed.length > 0
                          ? ` · não confirmado: ${proposal.unconfirmed.join(', ')}`
                          : ''}
                      </span>
                    </header>
                    <p>{proposal.reason}</p>
                    <Show when={proposal.source}>
                      <p class="brain-source">Fonte: {proposal.source}</p>
                    </Show>
                    <pre>{proposal.content}</pre>
                    <div class="approval-card-actions">
                      <button
                        type="button"
                        class="btn-primary"
                        disabled={busy()}
                        onClick={() => void decide(proposal, true)}
                      >
                        Aceitar
                      </button>
                      <button
                        type="button"
                        class="btn-secondary"
                        disabled={busy()}
                        onClick={() => void decide(proposal, false)}
                      >
                        Dispensar
                      </button>
                    </div>
                  </article>
                )}
              </For>
            </div>
          </Show>
          <div class="form-group">
            <label for="brain-page">Página</label>
            <select
              id="brain-page"
              value={editingSlug() ?? ''}
              onChange={(e) => {
                const slug = e.currentTarget.value
                openPage(slug ? (pages().find((page) => page.slug === slug) ?? null) : null)
              }}
            >
              <option value="">Nova página</option>
              <For each={pages()}>
                {(page) => (
                  <option value={page.slug}>
                    {page.title}
                    {page.unconfirmed.length > 0 ? ' · não confirmado' : ''}
                  </option>
                )}
              </For>
            </select>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label for="brain-title">Título</label>
              <input
                id="brain-title"
                value={title()}
                onInput={(e) => setTitle(e.currentTarget.value)}
              />
            </div>
            <div class="form-group">
              <label for="brain-type">Tipo</label>
              <select
                id="brain-type"
                value={type()}
                onChange={(e) => setType(e.currentTarget.value as BrainPageType)}
              >
                <For each={TYPES}>{(item) => <option value={item.id}>{item.label}</option>}</For>
              </select>
            </div>
          </div>
          <div class="form-group">
            <label for="brain-content">Conteúdo</label>
            <textarea
              id="brain-content"
              rows={12}
              value={content()}
              onInput={(e) => setContent(e.currentTarget.value)}
            />
          </div>
          <Show when={error()}>
            <p class="brain-error">{error()}</p>
          </Show>
          <div class="approval-card-actions">
            <button type="button" class="btn-primary" disabled={busy()} onClick={() => void save()}>
              Gravar
            </button>
            <Show when={editingSlug()}>
              <button
                type="button"
                class="btn-secondary"
                disabled={busy()}
                onClick={() => void remove()}
              >
                Apagar
              </button>
            </Show>
          </div>
        </div>
      </div>
    </dialog>
  )
}
