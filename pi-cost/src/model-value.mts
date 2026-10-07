#!/usr/bin/env -S pnpm exec tsx
/**
 * Model usage and value report: subscription cost, Pi session token usage,
 * and Artificial Analysis intelligence, per billing provider and model.
 *
 * Billing cycles come from each provider's own renewal evidence (capture +
 * provider APIs); tokens come from Pi session files only. Cost modes:
 * - amortized (default): cash paid within the current cycle, allocated
 *   across models — "what did the subscription cost me".
 * - consumption: payment-backed value consumed so far — plan at the
 *   utilization fraction (whole-cycle, daily-reset, or Anthropic's weekly
 *   snapshot proxy) plus consumed credits.
 *
 * Usage, from the repo root:
 *   pnpm exec tsx pi-cost/src/model-value.mts
 *   pnpm exec tsx pi-cost/src/model-value.mts --mode consumption
 *   pnpm exec tsx pi-cost/src/model-value.mts --mode amortized --json
 *
 * Billing capture is refreshed when stale (24 h) through ensureCapture; AA
 * data is cached for 24 h in ~/.cache/pi-billing. All required fetches
 * fail fast: no partial reports.
 */
import { parseArgs } from 'node:util'
import type { UsageReport } from './model-value/calculateUsage'
import { calculateUsage } from './model-value/calculateUsage'
import { formatTokens, formatValue } from './model-value/formatUsage'
import { loadUsageInputs } from './model-value/loadUsageInputs'

function printTable(params: {
  columns: string[]
  rows: string[][]
  align: Array<'left' | 'right'>
}): void {
  const widths = params.columns.map((column, index) =>
    Math.max(
      column.length,
      ...params.rows.map((row) => row[index]?.length ?? 0)
    )
  )
  const line = (cells: string[]) =>
    cells
      .map((cell, index) =>
        params.align[index] === 'right'
          ? cell.padStart(widths[index] ?? 0)
          : cell.padEnd(widths[index] ?? 0)
      )
      .join('  ')
  console.log(line(params.columns))
  for (const row of params.rows) console.log(line(row))
}

function printTerminalReport(params: {
  report: UsageReport
  mode: string
}): void {
  const { report } = params
  console.log('Models value')
  printTable({
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
  })
  console.log('')
  console.log('Providers summary')
  const paidColumns = params.mode === 'amortized'
  printTable({
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
      (paidColumns ? provider.extraPaidAud : provider.extraConsAud).toFixed(2),
      provider.subscriptionUsage === null
        ? '—'
        : `${(provider.subscriptionUsage * 100).toFixed(1)}%`,
    ]),
  })
}

function toJsonDocument(report: UsageReport) {
  return {
    mode: report.mode,
    generatedAt: report.generatedAt,
    models: report.models.map((model) => ({
      model: model.model,
      provider: model.provider,
      tokens: model.tokens,
      aud: model.allocatedAud,
      audPerMTok: model.audPerMTok,
      aaIdx: model.aaIndex,
      value: model.value,
    })),
    providers: report.providers.map((provider) => ({
      provider: provider.provider,
      cycle: `${provider.cycleStart} → ${provider.cycleEnd}`,
      tokens: provider.tokens,
      paidAud: provider.paidAud,
      extraPaidAud: provider.extraPaidAud,
      consAud: provider.consAud,
      extraConsAud: provider.extraConsAud,
      unallocatedAud: provider.unallocatedAud,
      allocationMethod: provider.allocationMethod,
      subscriptionUsage: provider.subscriptionUsage,
    })),
  }
}

async function main(): Promise<void> {
  const now = new Date()
  const { values } = parseArgs({
    options: {
      mode: { type: 'string' },
      json: { type: 'boolean' },
    },
  })
  const mode = values.mode ?? 'amortized'
  if (mode !== 'amortized' && mode !== 'consumption') {
    throw new Error(
      `--mode must be amortized or consumption, got "${values.mode}"`
    )
  }

  const inputs = await loadUsageInputs({ now })

  const report = calculateUsage({ mode, ...inputs, now })

  if (values.json) {
    console.log(JSON.stringify(toJsonDocument(report)))
    return
  }
  printTerminalReport({ report, mode })
}

main().catch((error) => {
  console.error('model-value failed', { error })
  process.exitCode = 1
})
