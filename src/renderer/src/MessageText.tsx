import { For, Match, Switch, createMemo } from 'solid-js'
import { Dynamic } from 'solid-js/web'
import { parseInlineText, parseTextBlocks } from './message-markdown'

function Inline(props: { text: string }) {
  return (
    <For each={parseInlineText(props.text)}>
      {(part) => (
        <Switch fallback={part.text}>
          <Match when={part.kind === 'strong'}>
            <strong>{part.text}</strong>
          </Match>
          <Match when={part.kind === 'em'}>
            <em>{part.text}</em>
          </Match>
          <Match when={part.kind === 'code'}>
            <code>{part.text}</code>
          </Match>
          <Match when={part.kind === 'link'}>
            <a href={part.href} target="_blank" rel="noopener noreferrer">
              {part.text}
            </a>
          </Match>
        </Switch>
      )}
    </For>
  )
}

/** JSX mantém HTML do modelo como texto; links aceitam apenas HTTP(S). */
export function MessageText(props: { text: string }) {
  const blocks = createMemo(() => parseTextBlocks(props.text))
  return (
    <div class="message-markdown">
      <For each={blocks()}>
        {(block) => (
          <Switch>
            <Match when={block.kind === 'code' && block}>
              {(code) => (
                <pre class="code-block-pre">
                  <code>{code().text}</code>
                </pre>
              )}
            </Match>
            <Match when={block.kind === 'paragraph' && block}>
              {(paragraph) => (
                <p>
                  <Inline text={paragraph().text} />
                </p>
              )}
            </Match>
            <Match when={block.kind === 'quote' && block}>
              {(quote) => (
                <blockquote>
                  <Inline text={quote().text} />
                </blockquote>
              )}
            </Match>
            <Match when={block.kind === 'heading' && block}>
              {(heading) => (
                <Dynamic component={`h${heading().level}`}>
                  <Inline text={heading().text} />
                </Dynamic>
              )}
            </Match>
            <Match when={block.kind === 'list' && block}>
              {(list) => (
                <Dynamic component={list().start === undefined ? 'ul' : 'ol'} start={list().start}>
                  <For each={list().items}>
                    {(item) => (
                      <li>
                        <Inline text={item} />
                      </li>
                    )}
                  </For>
                </Dynamic>
              )}
            </Match>
          </Switch>
        )}
      </For>
    </div>
  )
}
