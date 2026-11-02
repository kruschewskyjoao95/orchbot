import { describe, expect, it } from 'vitest'
import {
  parsePageDomSummary,
  redactSecrets,
  sanitizeHtmlToText,
  sanitizeUrl,
} from '../src/backend/browser/sanitizer'

describe('Browser Sanitizer & Security', () => {
  it('valida e normaliza URLs HTTP/HTTPS legítimas', () => {
    expect(sanitizeUrl('https://example.com/test')).toBe('https://example.com/test')
    expect(sanitizeUrl('http://example.com')).toBe('http://example.com/')
    expect(sanitizeUrl('github.com/orchbot')).toBe('https://github.com/orchbot')
  })

  it('rejeita protocolos proibidos (file://, chrome://, javascript:)', () => {
    expect(() => sanitizeUrl('file:///etc/passwd')).toThrow('Protocolo proibido')
    expect(() => sanitizeUrl('chrome://settings')).toThrow('Protocolo proibido')
    expect(() => sanitizeUrl('javascript:alert(1)')).toThrow('Protocolo proibido')
    expect(() => sanitizeUrl('')).toThrow('URL vazia')
  })

  it('redige segredos sensíveis em textos capturados', () => {
    const textWithSecret =
      'Configuração: api_key=sk-1234567890abcdef e token Bearer secret_token_xyz987'
    const redacted = redactSecrets(textWithSecret)

    expect(redacted).not.toContain('sk-1234567890abcdef')
    expect(redacted).not.toContain('secret_token_xyz987')
    expect(redacted).toContain('[REDACTED_SECRET]')
  })

  it('remove scripts, tags perigosas e normaliza texto HTML', () => {
    const dirtyHtml = `
      <html>
        <head>
          <script>alert("hack")</script>
          <style>body { color: red; }</style>
        </head>
        <body>
          <h1>Título Seguro</h1>
          <p>Conteúdo com &amp; entidades &quot;citadas&quot;</p>
          <iframe src="https://evil.com"></iframe>
        </body>
      </html>
    `
    const cleanText = sanitizeHtmlToText(dirtyHtml)
    expect(cleanText).not.toContain('alert')
    expect(cleanText).not.toContain('color: red')
    expect(cleanText).not.toContain('<script>')
    expect(cleanText).not.toContain('evil.com')
    expect(cleanText).toContain('Título Seguro')
    expect(cleanText).toContain('Conteúdo com & entidades "citadas"')
  })

  it('cria resumo DOM estruturado seguro', () => {
    const summary = parsePageDomSummary(
      'tab-1',
      'https://example.com',
      'Minha Página api_key=supersecretkey',
      '<p>Texto de teste</p>',
      [
        { text: 'Link 1', href: 'https://example.com/page1' },
        { text: 'Link Proibido', href: 'javascript:void(0)' },
      ],
      [{ id: 'search', name: 'q', type: 'text', placeholder: 'Buscar', selector: '#search' }],
    )

    expect(summary.tabId).toBe('tab-1')
    expect(summary.title).not.toContain('supersecretkey')
    expect(summary.title).toContain('[REDACTED_SECRET]')
    expect(summary.links).toHaveLength(1)
    expect(summary.links[0].href).toBe('https://example.com/page1')
    expect(summary.inputs).toHaveLength(1)
    expect(summary.inputs[0].id).toBe('search')
  })
})
