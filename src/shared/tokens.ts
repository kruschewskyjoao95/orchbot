/** Estimativa local de tokens: ~3,6 caracteres ASCII por token; CJK/emoji ≈ 1 token por caractere. */
export function estimateTokens(text: string): number {
  let ascii = 0
  let wide = 0
  for (const ch of text) (ch.codePointAt(0) ?? 0) >= 0x2e80 ? wide++ : ascii++
  return Math.ceil(ascii / 3.6 + wide)
}

/** Aproximação por contagem de caracteres quando só o tamanho está disponível (SQL). */
export const tokensFromChars = (chars: number): number => Math.ceil(chars / 3.6)

/** Janela de contexto aproximada por família de modelo (tokens). */
export function contextWindowFor(model: string): number {
  const m = model.toLowerCase()
  if (m.includes('gemini')) return 1_000_000
  if (m.includes('gpt-6') || m.includes('codex')) return 400_000
  if (m.includes('grok')) return 256_000
  if (m.includes('kimi')) return 256_000
  return 200_000
}
