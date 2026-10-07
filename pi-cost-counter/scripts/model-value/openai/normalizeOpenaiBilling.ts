import type { loadCapture } from '../../billing-capture/loadCapture'
import { fromLocalDayString, toLocalDayString } from '../localDayString'
import type { NormalizedProviderBilling } from '../normalizedProviderBilling'
import { usdToAud } from '../usdToAud'
import { fetchCreditUsageEvents } from './fetchCreditUsageEvents'
import { fetchDailyUsageBreakdown } from './fetchDailyUsageBreakdown'

type Capture = Awaited<ReturnType<typeof loadCapture>>

const defaultDeps = {
  fetchDailyUsageBreakdown,
  fetchCreditUsageEvents,
}

export async function normalizeOpenaiBilling(
  params: { capture: Capture['openai']; now: Date },
  deps = defaultDeps
): Promise<NormalizedProviderBilling> {
  // the previous renewal happens at the same UTC wall-clock one month
  // earlier (13:51Z payment vs 13:50Z renewal) — subtract on UTC wall-clock,
  // clamped to the target month's last day so the cycle-start day is the day
  // the payment landed
  const renewal = new Date(params.capture.subscriptions.entitlement.renews_at)
  const previousRenewal = new Date(renewal)
  previousRenewal.setUTCDate(1)
  previousRenewal.setUTCMonth(previousRenewal.getUTCMonth() - 1)
  const lastDayOfTargetMonth = new Date(
    Date.UTC(
      previousRenewal.getUTCFullYear(),
      previousRenewal.getUTCMonth() + 1,
      0
    )
  ).getUTCDate()
  previousRenewal.setUTCDate(
    Math.min(renewal.getUTCDate(), lastDayOfTargetMonth)
  )
  const cycleStart = toLocalDayString(previousRenewal)
  const cycleEnd = toLocalDayString(renewal)
  const cycleStartMs = fromLocalDayString(cycleStart).getTime()
  const cycleEndMs = fromLocalDayString(cycleEnd).getTime()
  const today = toLocalDayString(params.now)

  let planPaymentAud = 0
  let creditPurchasesAud = 0
  let hasPlanPayment = false
  for (const transaction of params.capture.transactionHistory.transactions) {
    if (transaction.status !== 'paid') continue
    const createdAt = Date.parse(transaction.created_at)
    if (!(createdAt >= cycleStartMs && createdAt < cycleEndMs)) continue
    const amountAud =
      transaction.currency.toLowerCase() === 'aud'
        ? transaction.amount / 100
        : usdToAud(transaction.amount / 100)
    if (transaction.product.type === 'subscription') {
      planPaymentAud += amountAud
      hasPlanPayment = true
    } else if (transaction.product.type === 'credits_top_up') {
      creditPurchasesAud += amountAud
    }
  }
  if (!hasPlanPayment) {
    throw new Error(
      `no paid OpenAI subscription payment in cycle ${cycleStart}..${cycleEnd}`
    )
  }

  const breakdown = await deps.fetchDailyUsageBreakdown({
    startDate: cycleStart,
    endDate: today,
  })
  const cycleDays = breakdown.data.filter(
    (day) => day.date >= cycleStart && day.date <= today
  )
  if (cycleDays.length === 0) {
    throw new Error(
      `daily usage breakdown covers no days of cycle ${cycleStart}..${cycleEnd}`
    )
  }
  let percentSum = 0
  const creditsByModel = new Map<string, number>()
  for (const day of cycleDays) {
    for (const model of day.models) {
      creditsByModel.set(
        model.model,
        (creditsByModel.get(model.model) ?? 0) + model.credits
      )
      percentSum += model.credits
    }
  }
  const totalCredits = [...creditsByModel.values()].reduce(
    (sum, value) => sum + value,
    0
  )

  const events = await deps.fetchCreditUsageEvents()
  let consumedCredits = 0
  for (const event of events.data) {
    if (event.date >= cycleStart && event.date <= today)
      consumedCredits += event.credit_amount
  }

  return {
    provider: 'openai',
    cycleStart,
    cycleEnd,
    planPaymentAud,
    creditPurchasesAud,
    utilization: {
      basis: 'elapsed',
      fraction: Math.min(1, percentSum / cycleDays.length / 100),
    },
    creditsConsumedAud:
      consumedCredits *
      params.capture.pricingConfig.currency_config.amount_per_credit,
    modelShares:
      totalCredits > 0
        ? [...creditsByModel].map(([model, credits]) => ({
            model,
            share: credits / totalCredits,
          }))
        : null,
  }
}

normalizeOpenaiBilling.defaultDeps = defaultDeps
