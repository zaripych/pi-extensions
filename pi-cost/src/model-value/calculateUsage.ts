import type { collectSessionCostRecords } from '../collectSessionCostRecords'
import { fromLocalDayString } from './localDayString'
import { normalizeModelId } from './normalizeModelId'
import type {
  NormalizedProviderBilling,
  ProviderId,
} from './normalizedProviderBilling'

export type CostMode = 'amortized' | 'consumption'

export type AllocationMethod = 'native' | 'token-share'

export type ModelUsage = {
  model: string
  provider: ProviderId
  tokens: number
  allocatedAud: number
  audPerMTok: number | null
  aaIndex: number | null
  value: number | '∞' | null
}

export type ProviderUsage = {
  provider: ProviderId
  cycleStart: string
  cycleEnd: string
  tokens: number
  paidAud: number
  extraPaidAud: number
  consAud: number
  extraConsAud: number
  unallocatedAud: number
  allocationMethod: AllocationMethod
  subscriptionUsage: number | null
}

export type UsageReport = {
  mode: CostMode
  generatedAt: string
  models: ModelUsage[]
  providers: ProviderUsage[]
}

type SessionRecord = Awaited<
  ReturnType<typeof collectSessionCostRecords>
>['records'][number]

/** The built-in `openai` provider is the separately billed api.openai.com
 * route — only `openai-codex` rides the ChatGPT subscription. */
const BILLING_ROUTES: Record<string, ProviderId> = {
  'openai-codex': 'openai',
  anthropic: 'anthropic',
  neuralwatt: 'neuralwatt',
}

function billingProviderOf(provider: string): ProviderId | undefined {
  return BILLING_ROUTES[provider]
}

function tokenCount(tokens: SessionRecord['tokens']): number {
  return tokens.input + tokens.output + tokens.cacheRead + tokens.cacheWrite
}

function valueRank(value: ModelUsage['value']): number {
  if (value === '∞') return Number.POSITIVE_INFINITY
  if (value === null) return Number.NEGATIVE_INFINITY
  return value
}

export function calculateUsage(params: {
  mode: CostMode
  providers: NormalizedProviderBilling[]
  records: SessionRecord[]
  aaScores: Map<string, number>
  now: Date
}): UsageReport {
  const models: ModelUsage[] = []
  const providers: ProviderUsage[] = []
  const nowMs = params.now.getTime()

  for (const billing of params.providers) {
    const cycleStartMs = fromLocalDayString(billing.cycleStart).getTime()
    const cycleEndMs = fromLocalDayString(billing.cycleEnd).getTime()

    const tokensByModel = new Map<string, number>()
    let providerTokens = 0
    for (const sessionRecord of params.records) {
      if (billingProviderOf(sessionRecord.provider) !== billing.provider)
        continue
      if (sessionRecord.ts < cycleStartMs || sessionRecord.ts >= cycleEndMs)
        continue
      if (sessionRecord.ts > nowMs) continue
      const tokens = tokenCount(sessionRecord.tokens)
      tokensByModel.set(
        sessionRecord.model,
        (tokensByModel.get(sessionRecord.model) ?? 0) + tokens
      )
      providerTokens += tokens
    }

    const paidAud = billing.planPaymentAud + billing.creditPurchasesAud
    // whole-cycle utilization applies to the whole allowance with no time
    // scaling, so its elapsed factor is 1
    const elapsedFraction =
      billing.utilization.basis === 'elapsed'
        ? Math.min(
            1,
            Math.max(0, (nowMs - cycleStartMs) / (cycleEndMs - cycleStartMs))
          )
        : 1
    const consAud =
      billing.planPaymentAud * elapsedFraction * billing.utilization.fraction +
      billing.creditsConsumedAud
    const costAud = params.mode === 'amortized' ? paidAud : consAud

    const allocationMethod: AllocationMethod =
      billing.modelShares !== null ? 'native' : 'token-share'
    const allocatedByModel = new Map<string, number>()
    let unallocatedAud = 0
    if (billing.modelShares !== null) {
      const totalShare = billing.modelShares.reduce(
        (sum, entry) => sum + entry.share,
        0
      )
      const shareByNormalizedId = new Map<string, number>()
      for (const entry of billing.modelShares) {
        const key = normalizeModelId(entry.model)
        shareByNormalizedId.set(
          key,
          (shareByNormalizedId.get(key) ?? 0) + entry.share
        )
      }
      const tokensByNormalizedId = new Map<string, number>()
      for (const [model, tokens] of tokensByModel) {
        const key = normalizeModelId(model)
        tokensByNormalizedId.set(
          key,
          (tokensByNormalizedId.get(key) ?? 0) + tokens
        )
      }
      let matchedShare = 0
      for (const [key, share] of shareByNormalizedId) {
        const groupTokens = tokensByNormalizedId.get(key)
        // zero-token record groups do not match — their cost stays unallocated
        if (groupTokens === undefined || groupTokens <= 0) continue
        matchedShare += share
        // equivalent record names split their shared allocation by tokens
        for (const [model, tokens] of tokensByModel) {
          if (normalizeModelId(model) !== key) continue
          allocatedByModel.set(model, costAud * share * (tokens / groupTokens))
        }
      }
      // native shares with no Pi counterpart stay unallocated — never redistributed
      unallocatedAud = Math.max(0, costAud * (totalShare - matchedShare))
    } else if (providerTokens > 0) {
      for (const [model, tokens] of tokensByModel) {
        allocatedByModel.set(model, costAud * (tokens / providerTokens))
      }
    } else {
      unallocatedAud = costAud
    }

    for (const [model, tokens] of tokensByModel) {
      const allocatedAud = allocatedByModel.get(model) ?? 0
      // an unmatched native model has missing attribution, not zero cost —
      // no rate, no value
      const hasAttribution = allocatedByModel.has(model)
      const audPerMTok =
        tokens > 0 && hasAttribution
          ? allocatedAud / (tokens / 1_000_000)
          : null
      const aaIndex = params.aaScores.get(model) ?? null
      let value: ModelUsage['value'] = null
      if (aaIndex !== null && audPerMTok !== null) {
        value = allocatedAud === 0 ? '∞' : aaIndex / audPerMTok
      }
      models.push({
        model,
        provider: billing.provider,
        tokens,
        allocatedAud,
        audPerMTok,
        aaIndex,
        value,
      })
    }

    providers.push({
      provider: billing.provider,
      cycleStart: billing.cycleStart,
      cycleEnd: billing.cycleEnd,
      tokens: providerTokens,
      paidAud,
      extraPaidAud: billing.creditPurchasesAud,
      consAud,
      extraConsAud: billing.creditsConsumedAud,
      unallocatedAud,
      allocationMethod,
      subscriptionUsage: billing.utilization.fraction,
    })
  }

  models.sort(
    (a, b) =>
      valueRank(b.value) - valueRank(a.value) ||
      b.tokens - a.tokens ||
      `${b.provider}/${b.model}`.localeCompare(`${a.provider}/${a.model}`)
  )

  return {
    mode: params.mode,
    generatedAt: params.now.toISOString(),
    models,
    providers,
  }
}
