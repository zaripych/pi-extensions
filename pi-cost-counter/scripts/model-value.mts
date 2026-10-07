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
 *   pnpm exec tsx pi-cost-counter/scripts/model-value.mts
 *   pnpm exec tsx pi-cost-counter/scripts/model-value.mts --mode consumption
 *   pnpm exec tsx pi-cost-counter/scripts/model-value.mts --mode amortized --json
 *
 * Billing capture is refreshed when stale (24 h) through ensureCapture; AA
 * data is cached for 24 h in ~/.cache/pi-billing. All required fetches
 * fail fast: no partial reports.
 */
import { parseArgs } from 'node:util'
import { ensureCapture } from './billing-capture/ensureCapture'
import { collectSessionCostRecords } from '../collectSessionCostRecords'
import { resolveAaScores } from './model-value/artificial-analysis/resolveAaScores'
import { normalizeAnthropicBilling } from './model-value/anthropic/normalizeAnthropicBilling'
import { calculateUsage, type UsageReport } from './model-value/calculateUsage'
import {
  fromLocalDayString,
  toLocalDayString,
} from './model-value/localDayString'
import { normalizeNeuralwattBilling } from './model-value/neuralwatt/normalizeNeuralwattBilling'
import { normalizeOpenaiBilling } from './model-value/openai/normalizeOpenaiBilling'
import { StaleBillingCaptureError } from './model-value/staleBillingCapture'

function formatTokens(tokens: number): string {
  if (tokens >= 1e9) return `${(tokens / 1e9).toFixed(1)} BTok`
  if (tokens >= 1e6) return `${(tokens / 1e6).toFixed(2)} MTok`
  if (tokens >= 1e3) return `${(tokens / 1e3).toFixed(1)} KTok`
  return String(tokens)
}

function formatValue(value: UsageReport['models'][number]['value']): string {
  if (value === '∞') return '∞ (zero-cost)'
  if (value === null) return '—'
  return value.toFixed(1)
}

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

  const captureResult = await ensureCapture({ now })
  if (!captureResult.ok) {
    console.error('billing capture failed', {
      error: captureResult.failure.error,
    })
    console.error(`response artifacts: ${captureResult.failure.artifactsPath}`)
    process.exitCode = 1
    return
  }

  const loadProviders = async (params: {
    openai: (typeof captureResult.data)['openai']
    anthropic: (typeof captureResult.data)['anthropic']
    neuralwatt: (typeof captureResult.data)['neuralwatt']
    now: Date
  }) => [
    await normalizeOpenaiBilling({ capture: params.openai, now: params.now }),
    await normalizeAnthropicBilling({ capture: params.anthropic }),
    await normalizeNeuralwattBilling({
      capture: params.neuralwatt,
      now: params.now,
    }),
  ]

  let providers
  try {
    providers = await loadProviders({ ...captureResult.data, now })
  } catch (error) {
    if (!(error instanceof StaleBillingCaptureError)) throw error
    const refreshed = await ensureCapture({ now, forceRefresh: true })
    if (!refreshed.ok) {
      console.error('billing capture refresh failed', {
        error: refreshed.failure.error,
      })
      console.error(`response artifacts: ${refreshed.failure.artifactsPath}`)
      process.exitCode = 1
      return
    }
    providers = await loadProviders({ ...refreshed.data, now })
  }

  // a capture can be fresh by mtime yet describe a cycle that has ended
  const today = toLocalDayString(now)
  if (providers.some((provider) => provider.cycleEnd <= today)) {
    const refreshed = await ensureCapture({ now, forceRefresh: true })
    if (!refreshed.ok) {
      console.error('billing capture refresh failed', {
        error: refreshed.failure.error,
      })
      console.error(`response artifacts: ${refreshed.failure.artifactsPath}`)
      process.exitCode = 1
      return
    }
    providers = await loadProviders({ ...refreshed.data, now })
  }

  const cycleStarts = providers.map((provider) =>
    fromLocalDayString(provider.cycleStart)
  )
  const cycleEnds = providers.map((provider) =>
    fromLocalDayString(provider.cycleEnd)
  )
  const { records } = await collectSessionCostRecords({
    start: new Date(Math.min(...cycleStarts.map((date) => date.getTime()))),
    end: new Date(Math.max(...cycleEnds.map((date) => date.getTime()))),
  })

  const aaScores = await resolveAaScores({
    now,
    models: [...new Set(records.map((record) => record.model))],
  })

  const report = calculateUsage({
    mode,
    providers,
    records,
    aaScores,
    now,
  })

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
