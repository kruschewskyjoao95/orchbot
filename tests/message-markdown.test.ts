import { describe, expect, it } from 'vitest'
import { parseInlineText, parseTextBlocks } from '../src/renderer/src/message-markdown'

describe('formatação das respostas', () => {
  it('destaca prioridades, ênfase e código sem interpretar HTML', () => {
    expect(parseInlineText('**Alta:** *validar* `a < b` <img src=x onerror=alert(1)>')).toEqual([
      { kind: 'strong', text: 'Alta:' },
      { kind: 'text', text: ' ' },
      { kind: 'em', text: 'validar' },
      { kind: 'text', text: ' ' },
      { kind: 'code', text: 'a < b' },
      { kind: 'text', text: ' <img src=x onerror=alert(1)>' },
    ])
    expect(parseInlineText('nome_do_arquivo')).toEqual([{ kind: 'text', text: 'nome_do_arquivo' }])
  })

  it('mantém somente links HTTP(S) e não permite protocolos executáveis ou locais', () => {
    expect(parseInlineText('[Docs](https://example.com/a?q=1&b=2)')).toEqual([
      { kind: 'link', text: 'Docs', href: 'https://example.com/a?q=1&b=2' },
    ])
    for (const href of [
      'javascript:alert',
      'data:text/html,test',
      'file:///etc/passwd',
      '/local',
      'https://',
    ]) {
      const text = `[Abrir](${href})`
      expect(parseInlineText(text)).toEqual([{ kind: 'text', text }])
    }
  })

  it('separa parágrafos, títulos, citações e listas com a numeração original', () => {
    expect(
      parseTextBlocks(
        '# Resumo\r\n\r\n- **Alta:** validar\r\n- Conferir\r\n\r\n3. Publicar\r\n4. Avisar\r\n\r\n> Aguardando aprovação\r\n\r\nFim.',
      ),
    ).toEqual([
      { kind: 'heading', text: 'Resumo', level: 1 },
      { kind: 'list', items: ['**Alta:** validar', 'Conferir'], start: undefined },
      { kind: 'list', items: ['Publicar', 'Avisar'], start: 3 },
      { kind: 'quote', text: 'Aguardando aprovação' },
      { kind: 'paragraph', text: 'Fim.' },
    ])
    expect(parseTextBlocks('Texto sem fechamento **\ncontinua')).toEqual([
      { kind: 'paragraph', text: 'Texto sem fechamento **\ncontinua' },
    ])
    expect(parseTextBlocks('')).toEqual([])
  })

  it('não junta listas separadas por parágrafo', () => {
    expect(parseTextBlocks('- Primeiro\n\nExplicação\n\n- Segundo')).toHaveLength(3)
  })

  it('preserva blocos de código completos ou ainda em streaming como texto literal', () => {
    const code = '<img src=x onerror=alert(1)>\n**não é negrito**'
    for (const suffix of ['\n```', '']) {
      expect(parseTextBlocks(`Antes\n\n\`\`\`html\n${code}${suffix}`)).toEqual([
        { kind: 'paragraph', text: 'Antes' },
        { kind: 'code', text: code },
      ])
    }
  })
})
