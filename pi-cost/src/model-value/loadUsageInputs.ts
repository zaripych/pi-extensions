import type { loadCapture } from '../billing-capture/loadCapture'
import type { ensureCapture } from '../billing-capture/ensureCapture'
import { collectSessionCostRecords } from '../collectSessionCostRecords'
import { toLocalDayString, fromLocalDayString } from './localDayString'
import { normalizeAnthropicBilling } from './anthropic/normalizeAnthropicBilling'
import { StaleBillingCaptureError } from './staleBillingCapture'
import type { NormalizedProviderBilling } from './normalizedProviderBilling'
import { normalizeNeuralwattBilling } from './neuralwatt/normalizeNeuralwattBilling'
import { normalizeOpenaiBilling } from './openai/normalizeOpenaiBilling'
import { resolveAaScores } from './artificial-analysis/resolveAaScores'

type Capture = Awaited<ReturnType<typeof loadCapture>>
type SessionRecord = Awaited<
  ReturnType<typeof collectSessionCostRecords>
>['records'][number]

export type UsageInputs = {
  providers: NormalizedProviderBilling[]
  records: SessionRecord[]
  aaScores: Map<string, number>
}

/** ensureCapture pulls in the browser capture chain (puppeteer) — load it
 * lazily so importing this module stays light for the pi extension. */
const lazyEnsureCapture = (
  params: Parameters<typeof ensureCapture>[0]
): ReturnType<typeof ensureCapture> =>
  import('../billing-capture/ensureCapture').then((module) =>
    module.ensureCapture(params)
  )

const defaultDeps = {
  ensureCapture: lazyEnsureCapture,
  collectSessionCostRecords,
  resolveAaScores,
  normalizeOpenaiBilling,
  normalizeAnthropicBilling,
  normalizeNeuralwattBilling,
}

function captureFailure(params: {
  error: unknown
  artifactsPath: string
}): Error {
  const message =
    params.error instanceof Error ? params.error.message : String(params.error)
  return new Error(
    `billing capture failed: ${message} (artifacts: ${params.artifactsPath})`,
    {
      cause: params.error,
    }
  )
}

/** Loads every input calculateUsage needs: normalized providers (with stale
 * and expired billing captures refreshed once), cycle-filtered Pi records,
 * and AA intelligence scores. */
export async function loadUsageInputs(
  params: { now: Date },
  deps = defaultDeps
): Promise<UsageInputs> {
  const captureResult = await deps.ensureCapture({ now: params.now })
  if (!captureResult.ok) {
    throw captureFailure({
      error: captureResult.failure.error,
      artifactsPath: captureResult.failure.artifactsPath,
    })
  }

  const loadProviders = async (capture: {
    openai: Capture['openai']
    anthropic: Capture['anthropic']
    neuralwatt: Capture['neuralwatt']
  }) => [
    await deps.normalizeOpenaiBilling({
      capture: capture.openai,
      now: params.now,
    }),
    await deps.normalizeAnthropicBilling({ capture: capture.anthropic }),
    await deps.normalizeNeuralwattBilling({
      capture: capture.neuralwatt,
      now: params.now,
    }),
  ]

  let providers: NormalizedProviderBilling[]
  try {
    providers = await loadProviders(captureResult.data)
  } catch (error) {
    if (!(error instanceof StaleBillingCaptureError)) throw error
    const refreshed = await deps.ensureCapture({
      now: params.now,
      forceRefresh: true,
    })
    if (!refreshed.ok) {
      throw captureFailure({
        error: refreshed.failure.error,
        artifactsPath: refreshed.failure.artifactsPath,
      })
    }
    providers = await loadProviders(refreshed.data)
  }

  // a capture can be fresh by mtime yet describe a cycle that has ended
  const today = toLocalDayString(params.now)
  if (providers.some((provider) => provider.cycleEnd <= today)) {
    const refreshed = await deps.ensureCapture({
      now: params.now,
      forceRefresh: true,
    })
    if (!refreshed.ok) {
      throw captureFailure({
        error: refreshed.failure.error,
        artifactsPath: refreshed.failure.artifactsPath,
      })
    }
    providers = await loadProviders(refreshed.data)
  }

  const cycleStarts = providers.map((provider) =>
    fromLocalDayString(provider.cycleStart)
  )
  const cycleEnds = providers.map((provider) =>
    fromLocalDayString(provider.cycleEnd)
  )
  const { records } = await deps.collectSessionCostRecords({
    start: new Date(Math.min(...cycleStarts.map((date) => date.getTime()))),
    end: new Date(Math.max(...cycleEnds.map((date) => date.getTime()))),
  })

  const aaScores = await deps.resolveAaScores({
    now: params.now,
    models: [...new Set(records.map((record) => record.model))],
  })

  return { providers, records, aaScores }
}

loadUsageInputs.defaultDeps = defaultDeps
