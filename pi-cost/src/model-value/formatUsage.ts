export function formatTokens(tokens: number): string {
  if (tokens >= 1e9) return `${(tokens / 1e9).toFixed(1)} BTok`
  if (tokens >= 1e6) return `${(tokens / 1e6).toFixed(2)} MTok`
  if (tokens >= 1e3) return `${(tokens / 1e3).toFixed(1)} KTok`
  return String(tokens)
}

export function formatValue(value: number | '∞' | null): string {
  if (value === '∞') return '∞ (zero-cost)'
  if (value === null) return '—'
  return value.toFixed(1)
}
