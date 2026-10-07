import { describe, expect, it } from 'vitest'
import type { collectSessionCostRecords } from '../../collectSessionCostRecords'
import { calculateUsage } from './calculateUsage'
import type { NormalizedProviderBilling } from './normalizedProviderBilling'

type SessionRecord = Awaited<
  ReturnType<typeof collectSessionCostRecords>
>['records'][number]

function record(params: {
  provider: string
  model: string
  ts: number
  tokens?: Partial<SessionRecord['tokens']>
}): SessionRecord {
  return {
    ts: params.ts,
    sessionId: 'session-1',
    cwd: '/tmp',
    provider: params.provider,
    model: params.model,
    tokens: {
      input: params.tokens?.input ?? 0,
      output: params.tokens?.output ?? 0,
      cacheRead: params.tokens?.cacheRead ?? 0,
      cacheWrite: params.tokens?.cacheWrite ?? 0,
    },
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  }
}

const MS_PER_DAY = 86_400_000
/** 2026-09-01 local midnight — cycle start for the default test provider. */
const CYCLE_START = new Date(2026, 8, 1).getTime()

function billing(
  params: Partial<NormalizedProviderBilling> = {}
): NormalizedProviderBilling {
  return {
    provider: 'openai',
    cycleStart: '2026-09-01',
    cycleEnd: '2026-10-01',
    planPaymentAud: 40,
    creditPurchasesAud: 0,
    utilization: { basis: 'elapsed', fraction: 0.5 },
    creditsConsumedAud: 0,
    modelShares: null,
    ...params,
  }
}

const MILLION = 1_000_000

describe('calculateUsage', () => {
  it('reports mode and generation time', () => {
    const now = new Date('2026-09-15T12:00:00+10:00')

    const report = calculateUsage({
      mode: 'amortized',
      providers: [billing()],
      records: [],
      aaScores: new Map(),
      now,
    })

    expect(report.mode).toBe('amortized')
    expect(report.generatedAt).toBe(now.toISOString())
  })

  it('allocates amortized provider cost by Pi token share across all four token categories', () => {
    const tokens = {
      input: 300_000,
      output: 200_000,
      cacheRead: 400_000,
      cacheWrite: 100_000,
    }
    const report = calculateUsage({
      mode: 'amortized',
      providers: [billing({ planPaymentAud: 40 })],
      records: [
        record({
          provider: 'openai-codex',
          model: 'model-a',
          ts: CYCLE_START + MS_PER_DAY,
          tokens,
        }),
        record({
          provider: 'openai-codex',
          model: 'model-b',
          ts: CYCLE_START + 2 * MS_PER_DAY,
          tokens: { input: 1_000_000 },
        }),
      ],
      aaScores: new Map(),
      now: new Date(2026, 8, 15),
    })

    const modelA = report.models.find((model) => model.model === 'model-a')
    const modelB = report.models.find((model) => model.model === 'model-b')
    expect(modelA?.tokens).toBe(MILLION)
    expect(modelB?.tokens).toBe(MILLION)
    expect(modelA?.allocatedAud).toBe(20)
    expect(modelB?.allocatedAud).toBe(20)
    // token-share allocation: every model gets the same rate — 40 AUD / 2 MTok
    expect(modelA?.audPerMTok).toBe(20)
    expect(modelB?.audPerMTok).toBe(20)
    expect(report.providers[0]).toMatchObject({
      provider: 'openai',
      tokens: 2 * MILLION,
      paidAud: 40,
      extraPaidAud: 0,
      allocationMethod: 'token-share',
      unallocatedAud: 0,
    })
  })

  it('computes consumption cost from elapsed cycle fraction and average daily utilization', () => {
    // numerical acceptance example 2: 30 AUD plan, 30-day cycle observed
    // after 10 days at 50% average daily utilization → 5 AUD plan
    // component; 3 AUD credits consumed and 8 AUD purchased
    const report = calculateUsage({
      mode: 'consumption',
      providers: [
        billing({
          planPaymentAud: 30,
          creditPurchasesAud: 8,
          creditsConsumedAud: 3,
          utilization: { basis: 'elapsed', fraction: 0.5 },
        }),
      ],
      records: [
        record({
          provider: 'openai-codex',
          model: 'model-a',
          ts: CYCLE_START + MS_PER_DAY,
          tokens: { input: 1_000_000 },
        }),
      ],
      aaScores: new Map(),
      now: new Date(2026, 8, 11),
    })

    expect(report.providers[0]).toMatchObject({
      paidAud: 38,
      extraPaidAud: 8,
      consAud: 8,
      extraConsAud: 3,
      subscriptionUsage: 0.5,
    })
    expect(report.models[0]?.allocatedAud).toBe(8)
  })

  it('applies whole-cycle utilization without time scaling on a partial cycle', () => {
    // numerical acceptance example 1: 30 AUD plan with 5% of the whole-cycle
    // allowance consumed → 1.50 AUD regardless of cycle progress
    const report = calculateUsage({
      mode: 'consumption',
      providers: [
        billing({
          provider: 'neuralwatt',
          planPaymentAud: 30,
          utilization: { basis: 'whole-cycle', fraction: 0.05 },
        }),
      ],
      records: [
        record({
          provider: 'neuralwatt',
          model: 'model-a',
          ts: CYCLE_START + MS_PER_DAY,
          tokens: { input: 1_000_000 },
        }),
      ],
      aaScores: new Map(),
      now: new Date(2026, 8, 11),
    })

    expect(report.providers[0]?.consAud).toBeCloseTo(1.5, 10)
  })

  it('keeps amortized cost at full cycle payment without prorating', () => {
    const report = calculateUsage({
      mode: 'amortized',
      providers: [billing({ planPaymentAud: 30, creditPurchasesAud: 8 })],
      records: [
        record({
          provider: 'openai-codex',
          model: 'model-a',
          ts: CYCLE_START + MS_PER_DAY,
          tokens: { input: 1_000_000 },
        }),
      ],
      aaScores: new Map(),
      now: new Date(2026, 8, 11),
    })

    expect(report.providers[0]?.paidAud).toBe(38)
    expect(report.models[0]?.allocatedAud).toBe(38)
  })

  it('clamps the elapsed fraction at the full cycle', () => {
    const report = calculateUsage({
      mode: 'consumption',
      providers: [
        billing({
          planPaymentAud: 30,
          utilization: { basis: 'elapsed', fraction: 0.5 },
        }),
      ],
      records: [
        record({
          provider: 'openai-codex',
          model: 'model-a',
          ts: CYCLE_START + MS_PER_DAY,
          tokens: { input: 1_000_000 },
        }),
      ],
      aaScores: new Map(),
      now: new Date(2026, 9, 15),
    })

    expect(report.providers[0]?.consAud).toBe(15)
  })

  it('filters records to the provider cycle, measurement time, and billing route', () => {
    const report = calculateUsage({
      mode: 'amortized',
      providers: [billing()],
      records: [
        record({
          provider: 'openai-codex',
          model: 'in-cycle',
          ts: CYCLE_START + MS_PER_DAY,
          tokens: { input: 1_000_000 },
        }),
        record({
          provider: 'openai-codex',
          model: 'before-cycle',
          ts: CYCLE_START - MS_PER_DAY,
          tokens: { input: 1_000_000 },
        }),
        record({
          provider: 'openai-codex',
          model: 'after-cycle',
          ts: new Date(2026, 9, 1).getTime(),
          tokens: { input: 1_000_000 },
        }),
        record({
          provider: 'openai-codex',
          model: 'future',
          ts: new Date(2026, 11, 1).getTime(),
          tokens: { input: 1_000_000 },
        }),
        record({
          provider: 'other-provider',
          model: 'other',
          ts: CYCLE_START + MS_PER_DAY,
          tokens: { input: 1_000_000 },
        }),
        // the built-in openai provider is the separately billed API route,
        // not the ChatGPT subscription
        record({
          provider: 'openai',
          model: 'api-route',
          ts: CYCLE_START + MS_PER_DAY,
          tokens: { input: 1_000_000 },
        }),
      ],
      aaScores: new Map(),
      now: new Date(2026, 8, 15),
    })

    expect(report.models.map((model) => model.model)).toEqual(['in-cycle'])
    expect(report.providers[0]?.tokens).toBe(MILLION)
  })

  it('keeps unmatched native model shares as unallocated cost and reconciles the provider total', () => {
    const report = calculateUsage({
      mode: 'amortized',
      providers: [
        billing({
          planPaymentAud: 40,
          modelShares: [
            { model: 'model-a', share: 0.25 },
            { model: 'other-client-model', share: 0.75 },
          ],
        }),
      ],
      records: [
        record({
          provider: 'openai-codex',
          model: 'model-a',
          ts: CYCLE_START + MS_PER_DAY,
          tokens: { input: 2_000_000 },
        }),
      ],
      aaScores: new Map(),
      now: new Date(2026, 8, 15),
    })

    expect(report.providers[0]).toMatchObject({
      allocationMethod: 'native',
      unallocatedAud: 30,
    })
    expect(report.models[0]).toMatchObject({
      model: 'model-a',
      allocatedAud: 10,
    })
    const allocated = report.models.reduce(
      (sum, model) => sum + model.allocatedAud,
      0
    )
    expect(allocated + (report.providers[0]?.unallocatedAud ?? 0)).toBeCloseTo(
      40,
      10
    )
  })

  it('matches native shares to record model names across separator conventions', () => {
    const report = calculateUsage({
      mode: 'amortized',
      providers: [
        billing({
          modelShares: [
            { model: 'gpt-5.2-codex', share: 1 },
            { model: 'other-client-model', share: 0 },
          ],
        }),
      ],
      records: [
        record({
          provider: 'openai-codex',
          model: 'gpt-5-2-codex',
          ts: CYCLE_START + MS_PER_DAY,
          tokens: { input: 1_000_000 },
        }),
      ],
      aaScores: new Map(),
      now: new Date(2026, 8, 15),
    })

    expect(report.models[0]).toMatchObject({
      model: 'gpt-5-2-codex',
      allocatedAud: 40,
    })
    expect(report.providers[0]?.unallocatedAud).toBe(0)
  })

  it('splits a matched native share across equivalent record names by tokens', () => {
    const report = calculateUsage({
      mode: 'amortized',
      providers: [
        billing({
          planPaymentAud: 40,
          modelShares: [{ model: 'gpt-5-2-codex', share: 1 }],
        }),
      ],
      records: [
        record({
          provider: 'openai-codex',
          model: 'gpt-5.2-codex',
          ts: CYCLE_START + MS_PER_DAY,
          tokens: { input: 1_000_000 },
        }),
        record({
          provider: 'openai-codex',
          model: 'gpt-5-2-codex',
          ts: CYCLE_START + MS_PER_DAY,
          tokens: { input: 3_000_000 },
        }),
      ],
      aaScores: new Map(),
      now: new Date(2026, 8, 15),
    })

    const dotted = report.models.find(
      (model) => model.model === 'gpt-5.2-codex'
    )
    const dashed = report.models.find(
      (model) => model.model === 'gpt-5-2-codex'
    )
    expect(dotted).toMatchObject({ allocatedAud: 10, audPerMTok: 10 })
    expect(dashed).toMatchObject({ allocatedAud: 30, audPerMTok: 10 })
    expect(report.providers[0]?.unallocatedAud).toBe(0)
  })

  it('leaves native cost unallocated when only zero-token records match', () => {
    const report = calculateUsage({
      mode: 'amortized',
      providers: [
        billing({
          planPaymentAud: 30,
          modelShares: [{ model: 'model-a', share: 1 }],
        }),
      ],
      records: [
        record({
          provider: 'openai-codex',
          model: 'model-a',
          ts: CYCLE_START + MS_PER_DAY,
        }),
      ],
      aaScores: new Map(),
      now: new Date(2026, 8, 15),
    })

    expect(report.models[0]).toMatchObject({
      tokens: 0,
      allocatedAud: 0,
      audPerMTok: null,
      value: null,
    })
    expect(report.providers[0]).toMatchObject({ tokens: 0, unallocatedAud: 30 })
  })

  it('leaves rate and value null for native-unmatched models with tokens and a score', () => {
    const report = calculateUsage({
      mode: 'amortized',
      providers: [
        billing({
          planPaymentAud: 30,
          modelShares: [{ model: 'other-client-model', share: 1 }],
        }),
      ],
      records: [
        record({
          provider: 'openai-codex',
          model: 'unattributed',
          ts: CYCLE_START + MS_PER_DAY,
          tokens: { input: 1_000_000 },
        }),
      ],
      aaScores: new Map([['unattributed', 50]]),
      now: new Date(2026, 8, 15),
    })

    expect(report.models[0]).toMatchObject({
      tokens: MILLION,
      allocatedAud: 0,
      audPerMTok: null,
      aaIndex: 50,
      value: null,
    })
    expect(report.providers[0]?.unallocatedAud).toBe(30)
  })

  it('retains the provider summary with fully unallocated cost when no Pi tokens are recorded', () => {
    const report = calculateUsage({
      mode: 'amortized',
      providers: [
        billing({
          planPaymentAud: 30,
          modelShares: [{ model: 'native-model', share: 1 }],
        }),
      ],
      records: [],
      aaScores: new Map(),
      now: new Date(2026, 8, 15),
    })

    expect(report.models).toEqual([])
    expect(report.providers[0]).toMatchObject({
      tokens: 0,
      paidAud: 30,
      unallocatedAud: 30,
      allocationMethod: 'native',
    })
  })

  it('gives zero-token models no rate or value', () => {
    const report = calculateUsage({
      mode: 'amortized',
      providers: [billing()],
      records: [
        record({
          provider: 'openai-codex',
          model: 'empty',
          ts: CYCLE_START + MS_PER_DAY,
        }),
      ],
      aaScores: new Map([['empty', 50]]),
      now: new Date(2026, 8, 15),
    })

    expect(report.models[0]).toMatchObject({
      tokens: 0,
      audPerMTok: null,
      aaIndex: 50,
      value: null,
    })
  })

  it('reports infinite value for zero-cost models with tokens and an intelligence score', () => {
    const report = calculateUsage({
      mode: 'amortized',
      providers: [billing({ planPaymentAud: 0 })],
      records: [
        record({
          provider: 'openai-codex',
          model: 'model-a',
          ts: CYCLE_START + MS_PER_DAY,
          tokens: { input: 1_000_000 },
        }),
      ],
      aaScores: new Map([['model-a', 50]]),
      now: new Date(2026, 8, 15),
    })

    expect(report.models[0]).toMatchObject({
      allocatedAud: 0,
      aaIndex: 50,
      value: '∞',
    })
  })

  it('reports value as intelligence index per AUD/MTok and null without an AA evaluation', () => {
    // two models at 2 MTok each split 40 AUD → 20 AUD each → 10 AUD/MTok; index 40 → value 4
    const report = calculateUsage({
      mode: 'amortized',
      providers: [billing({ planPaymentAud: 40 })],
      records: [
        record({
          provider: 'openai-codex',
          model: 'scored',
          ts: CYCLE_START + MS_PER_DAY,
          tokens: { input: 2_000_000 },
        }),
        record({
          provider: 'openai-codex',
          model: 'unscored',
          ts: CYCLE_START + MS_PER_DAY,
          tokens: { input: 2_000_000 },
        }),
      ],
      aaScores: new Map([['scored', 40]]),
      now: new Date(2026, 8, 15),
    })

    const scored = report.models.find((model) => model.model === 'scored')
    const unscored = report.models.find((model) => model.model === 'unscored')
    expect(scored).toMatchObject({ aaIndex: 40, audPerMTok: 10, value: 4 })
    expect(unscored).toMatchObject({ aaIndex: null, value: null })
  })

  it('sorts models by descending value with infinite first and unscored last', () => {
    const report = calculateUsage({
      mode: 'amortized',
      providers: [billing({ planPaymentAud: 0 })],
      records: [
        record({
          provider: 'openai-codex',
          model: 'finite',
          ts: CYCLE_START + MS_PER_DAY,
          tokens: { input: 1_000_000 },
        }),
        record({
          provider: 'openai-codex',
          model: 'free-scored',
          ts: CYCLE_START + MS_PER_DAY,
          tokens: { input: 1_000_000 },
        }),
        record({
          provider: 'openai-codex',
          model: 'unscored',
          ts: CYCLE_START + MS_PER_DAY,
          tokens: { input: 1_000_000 },
        }),
      ],
      aaScores: new Map([
        ['free-scored', 10],
        ['finite', 60],
      ]),
      now: new Date(2026, 8, 15),
    })

    expect(report.models.map((model) => model.model)).toEqual([
      'free-scored',
      'finite',
      'unscored',
    ])
  })

  it('reports one provider summary per normalized provider', () => {
    const report = calculateUsage({
      mode: 'amortized',
      providers: [
        billing({ provider: 'openai' }),
        billing({
          provider: 'anthropic',
          cycleStart: '2026-09-19',
          cycleEnd: '2026-10-19',
        }),
      ],
      records: [],
      aaScores: new Map(),
      now: new Date(2026, 8, 15),
    })

    expect(report.providers.map((provider) => provider.provider)).toEqual([
      'openai',
      'anthropic',
    ])
    expect(report.providers[1]).toMatchObject({
      cycleStart: '2026-09-19',
      cycleEnd: '2026-10-19',
    })
  })
})
