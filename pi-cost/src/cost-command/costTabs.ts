import type { Theme } from '@earendil-works/pi-coding-agent'
import { truncateToWidth, visibleWidth } from '@earendil-works/pi-tui'
import type { UsageReport } from '../model-value/calculateUsage'
import { formatTokens, formatValue } from '../model-value/formatUsage'

const USAGE_BAR_CELLS = 10
/** percentage text width — worst case is `100.0%` */
const USAGE_PCT_CELLS = 6

type TabRenderer = (
  report: UsageReport,
  params: { contentWidth: number; maxWidth: number; theme: Theme }
) => string[]

type Severity = 'success' | 'warning' | 'error'

function severityFromRemaining(remaining: number): Severity {
  if (remaining > 0.5) return 'success'
  if (remaining > 0.2) return 'warning'
  return 'error'
}

function usageBar(usage: number, theme: Theme): string {
  const remaining = Math.min(1, Math.max(0, 1 - usage))
  const filledCount = Math.round(remaining * USAGE_BAR_CELLS)
  const severity = severityFromRemaining(remaining)
  const bar =
    theme.fg(severity, '█'.repeat(filledCount)) +
    theme.fg('dim', '░'.repeat(USAGE_BAR_CELLS - filledCount))
  const pct = `${(usage * 100).toFixed(1)}%`.padStart(USAGE_PCT_CELLS)
  return `${bar} ${theme.fg(severity, pct)}`
}

function renderTable(params: {
  theme: Theme
  maxWidth: number
  columns: string[]
  align: Array<'left' | 'right'>
  rows: string[][]
}): string[] {
  const widths = params.columns.map((column, index) =>
    Math.max(
      column.length,
      ...params.rows.map((row) => visibleWidth(row[index] ?? ''))
    )
  )
  const line = (cells: string[], dim: boolean) => {
    const styled = cells.map((cell, index) => {
      const padded =
        params.align[index] === 'right'
          ? ' '.repeat(Math.max(0, (widths[index] ?? 0) - visibleWidth(cell))) +
            cell
          : cell +
            ' '.repeat(Math.max(0, (widths[index] ?? 0) - visibleWidth(cell)))
      return dim ? params.theme.fg('dim', padded) : padded
    })
    return truncateToWidth(`  ${styled.join('  ')}`, params.maxWidth)
  }
  const lines = [line(params.columns, true)]
  for (const row of params.rows) lines.push(line(row, false))
  return lines
}

export const renderSpendTab: TabRenderer = (report, params) => {
  const paidColumns = report.mode === 'amortized'
  const total = report.providers.reduce(
    (sum, provider) =>
      sum + (paidColumns ? provider.paidAud : provider.consAud),
    0
  )
  const totalTokens = report.providers.reduce(
    (sum, provider) => sum + provider.tokens,
    0
  )
  return [
    '',
    ...renderTable({
      theme: params.theme,
      maxWidth: params.maxWidth,
      columns: [
        'PROVIDER',
        'CYCLE',
        'TOKENS',
        paidColumns ? 'TOTAL PAID' : 'TOTAL CONS',
        paidColumns ? 'EXTRA PAID' : 'EXTRA CONS',
        'USAGE',
      ],
      align: ['left', 'left', 'right', 'right', 'right', 'right'],
      rows: report.providers.map((provider) => [
        provider.provider,
        `${provider.cycleStart} → ${provider.cycleEnd}`,
        formatTokens(provider.tokens),
        (paidColumns ? provider.paidAud : provider.consAud).toFixed(2),
        (paidColumns ? provider.extraPaidAud : provider.extraConsAud).toFixed(
          2
        ),
        provider.subscriptionUsage === null
          ? '—'
          : usageBar(provider.subscriptionUsage, params.theme),
      ]),
    }),
    '',
    `  total ${paidColumns ? 'paid' : 'consumed'} this cycle: ${total.toFixed(2)} AUD`,
    `  total tokens this cycle: ${formatTokens(totalTokens)}`,
  ]
}

export const renderModelValueTab: TabRenderer = (report, params) => {
  return [
    '',
    ...renderTable({
      theme: params.theme,
      maxWidth: params.maxWidth,
      columns: [
        'MODEL',
        'PROVIDER',
        'TOKENS',
        'AUD',
        'AUD/MTOK',
        'AA IDX',
        'VALUE',
      ],
      align: ['left', 'left', 'right', 'right', 'right', 'right', 'right'],
      rows: report.models.map((model) => [
        model.model,
        model.provider,
        formatTokens(model.tokens),
        model.allocatedAud.toFixed(2),
        model.audPerMTok === null ? '—' : model.audPerMTok.toFixed(2),
        model.aaIndex === null ? '—' : model.aaIndex.toFixed(0),
        formatValue(model.value),
      ]),
    }),
  ]
}
