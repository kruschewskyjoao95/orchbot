export interface InlineText {
  kind: 'text' | 'strong' | 'em' | 'code' | 'link'
  text: string
  href?: string
}

export type TextBlock =
  | { kind: 'paragraph' | 'quote'; text: string }
  | { kind: 'heading'; text: string; level: number }
  | { kind: 'code'; text: string }
  | { kind: 'list'; items: string[]; start?: number }

// shortcut: Markdown básico sem tabelas e listas aninhadas; ampliar quando esses formatos forem necessários.
export function parseInlineText(text: string): InlineText[] {
  const parts: InlineText[] = []
  const pattern =
    /`([^`\n]+)`|\[([^\]\n]+)\]\(([^\s)]+)\)|\*\*([^\n]+?)\*\*|__([^\n]+?)__|\*([^*\n]+)\*|(?<![\p{L}\p{N}])_([^_\n]+)_(?![\p{L}\p{N}])/gu
  let offset = 0
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0
    if (index > offset) parts.push({ kind: 'text', text: text.slice(offset, index) })
    if (match[1]) parts.push({ kind: 'code', text: match[1] })
    else if (match[2]) {
      let href: string | undefined
      try {
        const url = new URL(match[3])
        if (url.protocol === 'http:' || url.protocol === 'https:') href = url.href
      } catch {}
      parts.push(href ? { kind: 'link', text: match[2], href } : { kind: 'text', text: match[0] })
    } else if (match[4] || match[5]) parts.push({ kind: 'strong', text: match[4] ?? match[5] })
    else parts.push({ kind: 'em', text: match[6] ?? match[7] })
    offset = index + match[0].length
  }
  if (offset < text.length) parts.push({ kind: 'text', text: text.slice(offset) })
  return parts
}

export function parseTextBlocks(text: string): TextBlock[] {
  const blocks: TextBlock[] = []
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  let paragraph: string[] = []
  const flush = () => {
    if (paragraph.length) blocks.push({ kind: 'paragraph', text: paragraph.join('\n') })
    paragraph = []
  }
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]
    if (/^ {0,3}```[^`\s]*\s*$/.test(line)) {
      flush()
      const code: string[] = []
      while (++index < lines.length && !/^ {0,3}```\s*$/.test(lines[index])) code.push(lines[index])
      blocks.push({ kind: 'code', text: code.join('\n') })
      continue
    }
    if (!line.trim()) {
      flush()
      continue
    }
    const heading = /^(#{1,6})\s+(.+)$/.exec(line)
    const list = /^ {0,3}(?:([-+*])|(\d+)[.)])\s+(.+)$/.exec(line)
    const quote = /^>\s?(.*)$/.exec(line)
    if (heading || list || quote) flush()
    if (heading) blocks.push({ kind: 'heading', text: heading[2], level: heading[1].length })
    else if (list) {
      const start = list[2] === undefined ? undefined : Number(list[2])
      const previous = blocks.at(-1)
      if (previous?.kind === 'list' && (previous.start === undefined) === (start === undefined))
        previous.items.push(list[3])
      else blocks.push({ kind: 'list', items: [list[3]], start })
    } else if (quote) blocks.push({ kind: 'quote', text: quote[1] })
    else paragraph.push(line)
  }
  flush()
  return blocks
}
