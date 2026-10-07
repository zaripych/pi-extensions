import { describe, expect, it } from 'vitest'
import { StaleBillingCaptureError } from './staleBillingCapture'
import { setupLoadUsageInputs } from './loadUsageInputs.harness'

const NOW = () => new Date(2026, 8, 15)

const setup = setupLoadUsageInputs

describe('loadUsageInputs', () => {
  it('normalizes providers, collects records, and resolves AA scores', async () => {
    await using harness = await setup({
      collectSessionCostRecords: async () => ({
        records: [
          {
            ts: Date.now(),
            sessionId: 'session-1',
            cwd: '/tmp',
            provider: 'openai-codex',
            model: 'gpt-5.2-codex',
            tokens: {
              input: 1_000_000,
              output: 0,
              cacheRead: 0,
              cacheWrite: 0,
            },
            cost: {
              input: 0,
              output: 0,
              cacheRead: 0,
              cacheWrite: 0,
              total: 0,
            },
          },
        ],
        stats: { invalidJsonLines: 0, schemaMismatchLines: 0 },
      }),
      resolveAaScores: async () => new Map([['gpt-5.2-codex', 50]]),
    })

    const inputs = await harness.loadUsageInputs({ now: NOW() })

    expect(inputs.providers.map((provider) => provider.provider)).toEqual([
      'openai',
      'anthropic',
      'neuralwatt',
    ])
    expect(inputs.records[0]?.model).toBe('gpt-5.2-codex')
    expect(inputs.aaScores.get('gpt-5.2-codex')).toBe(50)
    expect(harness.ensureCapture).toHaveBeenCalledWith({ now: NOW() })
  })

  it('refreshes the capture once when a normalizer signals stale billing evidence', async () => {
    let neuralwattCalls = 0
    await using harness = await setup({
      normalizeNeuralwattBilling: async () => {
        neuralwattCalls += 1
        if (neuralwattCalls === 1) {
          throw new StaleBillingCaptureError('no renewal payment')
        }
        return harness.billing({ provider: 'neuralwatt' })
      },
    })

    await harness.loadUsageInputs({ now: NOW() })

    expect(neuralwattCalls).toBe(2)
    expect(harness.ensureCapture).toHaveBeenCalledWith({
      now: NOW(),
      forceRefresh: true,
    })
  })

  it('refreshes the capture once when a resolved cycle has ended', async () => {
    let forceRefreshes = 0
    await using harness = await setup({
      ensureCapture: async (params) => {
        if (params.forceRefresh === true) forceRefreshes += 1
        return harness.okCapture()
      },
      normalizeOpenaiBilling: async () =>
        harness.billing({
          provider: 'openai',
          cycleStart: '2026-07-01',
          cycleEnd: '2026-08-01',
        }),
    })

    await harness.loadUsageInputs({ now: NOW() })

    expect(forceRefreshes).toBe(1)
  })

  it('propagates a failed capture without loading providers', async () => {
    await using harness = await setup({
      ensureCapture: async () => harness.failingCapture(),
    })

    await expect(harness.loadUsageInputs({ now: NOW() })).rejects.toThrow(
      'billing capture failed'
    )
    expect(harness.normalizeOpenaiBilling).not.toHaveBeenCalled()
  })
})
