import type { loadCapture } from '../../billing-capture/loadCapture'
import { fromLocalDayString, toLocalDayString } from '../localDayString'
import type { NormalizedProviderBilling } from '../normalizedProviderBilling'
import { StaleBillingCaptureError } from '../staleBillingCapture'
import { usdToAud } from '../usdToAud'
import { fetchQuota } from './fetchQuota'
import { fetchUsageByModel } from './fetchUsageByModel'
import { fetchUsageSummary } from './fetchUsageSummary'

type Capture = Awaited<ReturnType<typeof loadCapture>>

const DAY_MS = 86_400_000

const defaultDeps = {
  fetchQuota,
  fetchUsageByModel,
  fetchUsageSummary,
}

function assertMatchingPeriod(params: {
  period: { start: string; end: string }
  startDate: string
  endDate: string
}): void {
  const startMs = Date.parse(params.period.start)
  const endMs = Date.parse(params.period.end)
  if (
    !Number.isFinite(startMs) ||
    !Number.isFinite(endMs) ||
    Math.abs(startMs - fromLocalDayString(params.startDate).getTime()) >
      DAY_MS ||
    Math.abs(endMs - fromLocalDayString(params.endDate).getTime()) > DAY_MS
  ) {
    throw new Error(
      `neuralwatt usage period ${params.period.start}..${params.period.end} does not match the requested window ${params.startDate}..${params.endDate}`
    )
  }
}

export async function normalizeNeuralwattBilling(
  params: { capture: Capture['neuralwatt']; now: Date },
  deps = defaultDeps
): Promise<NormalizedProviderBilling> {
  const quota = await deps.fetchQuota()
  const subscription = quota.subscription
  if (!subscription) {
    throw new Error('neuralwatt quota has no active subscription')
  }
  const cycleStart = toLocalDayString(
    new Date(subscription.current_period_start)
  )
  const cycleEnd = toLocalDayString(new Date(subscription.current_period_end))
  const cycleStartMs = fromLocalDayString(cycleStart).getTime()
  const cycleEndMs = fromLocalDayString(cycleEnd).getTime()
  if (!(subscription.kwh_included > 0)) {
    throw new Error('neuralwatt quota has no included kWh allowance')
  }

  // subscription history is an event log: only Renewed rows are charges
  let planPaymentUsd = 0
  for (const row of params.capture.billing.subscriptionBilling) {
    const rowTs = Date.parse(row.date)
    if (!Number.isFinite(rowTs) || rowTs < cycleStartMs || rowTs >= cycleEndMs)
      continue
    if (row.status !== 'Renewed' || row.amountUsd === null) continue
    planPaymentUsd += row.amountUsd
  }
  if (planPaymentUsd <= 0) {
    // the quota cycle is live: a missing renewal payment means the capture
    // predates the renewal
    throw new StaleBillingCaptureError(
      `no neuralwatt renewal payment in cycle ${cycleStart}..${cycleEnd}`
    )
  }

  let creditPurchasesUsd = 0
  for (const row of params.capture.billing.creditTransactions) {
    if (row.type !== 'Purchase') continue
    const rowTs = Date.parse(row.date)
    if (!Number.isFinite(rowTs) || rowTs < cycleStartMs || rowTs >= cycleEndMs)
      continue
    creditPurchasesUsd += row.amountUsd ?? 0
  }

  const today = toLocalDayString(params.now)

  // credits drain only in overage: overage energy priced at the metered
  // rate, cross-checked against the plan rate
  let creditsConsumedUsd = 0
  if (subscription.in_overage) {
    const summary = await deps.fetchUsageSummary({
      startDate: cycleStart,
      endDate: today,
    })
    assertMatchingPeriod({
      period: summary.period,
      startDate: cycleStart,
      endDate: today,
    })
    if (!(summary.totals.energy_kwh_charged > 0)) {
      throw new Error('neuralwatt usage summary has no charged energy')
    }
    const meteredRateUsdPerKwh =
      summary.totals.total_cost_usd / summary.totals.energy_kwh_charged
    const planRateUsdPerKwh = planPaymentUsd / subscription.kwh_included
    if (Math.abs(meteredRateUsdPerKwh - planRateUsdPerKwh) > 0.01) {
      throw new Error(
        `neuralwatt metered rate ${meteredRateUsdPerKwh} USD/kWh disagrees with the plan rate ${planRateUsdPerKwh} USD/kWh`
      )
    }
    creditsConsumedUsd =
      (subscription.kwh_used - subscription.kwh_included) * meteredRateUsdPerKwh
  }

  const byModel = await deps.fetchUsageByModel({
    startDate: cycleStart,
    endDate: today,
  })
  assertMatchingPeriod({
    period: byModel.period,
    startDate: cycleStart,
    endDate: today,
  })

  const usageByRequestedModel = new Map<
    string,
    { costUsd: number; tokens: number }
  >()
  for (const product of byModel.products) {
    const entry = usageByRequestedModel.get(product.requested_model) ?? {
      costUsd: 0,
      tokens: 0,
    }
    entry.costUsd += product.total_cost_usd
    entry.tokens += product.total_tokens
    usageByRequestedModel.set(product.requested_model, entry)
  }
  const totalCostUsd = [...usageByRequestedModel.values()].reduce(
    (sum, entry) => sum + entry.costUsd,
    0
  )
  const totalTokens = [...usageByRequestedModel.values()].reduce(
    (sum, entry) => sum + entry.tokens,
    0
  )
  const modelShares =
    totalCostUsd > 0
      ? [...usageByRequestedModel].map(([model, entry]) => ({
          model,
          share: entry.costUsd / totalCostUsd,
        }))
      : totalTokens > 0
        ? [...usageByRequestedModel].map(([model, entry]) => ({
            model,
            share: entry.tokens / totalTokens,
          }))
        : null

  return {
    provider: 'neuralwatt',
    cycleStart,
    cycleEnd,
    planPaymentAud: usdToAud(planPaymentUsd),
    creditPurchasesAud: usdToAud(creditPurchasesUsd),
    utilization: {
      basis: 'whole-cycle',
      fraction: Math.min(
        1,
        Math.max(0, subscription.kwh_used / subscription.kwh_included)
      ),
    },
    creditsConsumedAud: usdToAud(creditsConsumedUsd),
    modelShares,
  }
}

normalizeNeuralwattBilling.defaultDeps = defaultDeps
