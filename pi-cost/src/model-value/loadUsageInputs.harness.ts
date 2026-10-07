import { faker } from '@faker-js/faker'
import { fromPartial } from '@total-typescript/shoehorn'
import { configureDependencies } from 'foundation/testing/harness/configureDependencies'
import { configureHarnesses } from 'foundation/testing/harness/configureHarnesses'
import { withDeps } from 'foundation/testing/harness/withDeps'
import type { NormalizedProviderBilling } from './normalizedProviderBilling'
import { loadUsageInputs } from './loadUsageInputs'

type EnsureCapture = typeof loadUsageInputs.defaultDeps.ensureCapture
type CaptureResult = Awaited<ReturnType<EnsureCapture>>
type CaptureData = Extract<CaptureResult, { ok: true }>['data']
type CaptureFailure = Extract<CaptureResult, { ok: false }>['failure']

function billing(
  params: Partial<NormalizedProviderBilling> = {}
): NormalizedProviderBilling {
  return {
    provider: faker.helpers.arrayElement(['openai', 'anthropic', 'neuralwatt']),
    cycleStart: '2026-09-01',
    cycleEnd: '2026-10-01',
    planPaymentAud: faker.number.float({ min: 10, max: 100 }),
    creditPurchasesAud: 0,
    utilization: {
      basis: 'elapsed',
      fraction: faker.number.float({ min: 0, max: 1 }),
    },
    creditsConsumedAud: 0,
    modelShares: null,
    ...params,
  }
}

function okCapture(): CaptureResult {
  return { ok: true, data: fromPartial<CaptureData>({}) }
}

function failingCapture(): CaptureResult {
  return {
    ok: false,
    failure: fromPartial<CaptureFailure>({
      error: 'route failed',
      artifactsPath: '/tmp/artifacts',
    }),
  }
}

export const setupLoadUsageInputs = configureHarnesses(
  {
    inferTypesFrom: { defaultDeps: loadUsageInputs.defaultDeps },
  },
  async (userDeps) => {
    const deps = configureDependencies(
      {
        inferTypesFrom: { defaultDeps: loadUsageInputs.defaultDeps },
        userDeps,
      },
      {
        ensureCapture: async () => okCapture(),
        collectSessionCostRecords: async () => ({
          records: [],
          stats: { invalidJsonLines: 0, schemaMismatchLines: 0 },
        }),
        resolveAaScores: async () => new Map(),
        normalizeOpenaiBilling: async () => billing({ provider: 'openai' }),
        normalizeAnthropicBilling: async () =>
          billing({ provider: 'anthropic' }),
        normalizeNeuralwattBilling: async () =>
          billing({ provider: 'neuralwatt' }),
      }
    )
    return {
      ...deps,
      loadUsageInputs: withDeps(loadUsageInputs, deps),
      billing,
      okCapture,
      failingCapture,
    }
  }
)
