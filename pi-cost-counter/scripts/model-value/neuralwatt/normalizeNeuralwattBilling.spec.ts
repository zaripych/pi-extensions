import { describe, expect, it } from 'vitest'
import type { loadCapture } from '../../billing-capture/loadCapture'
import { StaleBillingCaptureError } from '../staleBillingCapture'
import { setupNormalizeNeuralwattBilling } from './normalizeNeuralwattBilling.harness'

type Capture = Awaited<ReturnType<typeof loadCapture>>
type NeuralwattCapture = Capture['neuralwatt']

const QUOTA = {
  subscription: {
    current_period_start: '2026-09-12T04:15:28Z',
    current_period_end: '2026-10-12T04:15:28Z',
    kwh_included: 6.25,
    kwh_used: 3.9549,
    in_overage: false,
  },
}

/** Inspected billing history: a September 12 renewal at 50 USD, a scheduled
 * downgrade with no amount, an August subscribe outside the cycle, and a
 * 1 USD payment-method bonus in July. */
function capture(params: Partial<NeuralwattCapture> = {}): NeuralwattCapture {
  return {
    billing: {
      subscriptionBilling: [
        {
          date: 'Sep 29, 2026 13:35',
          event: 'Downgrade to Basic scheduled',
          amountUsd: null,
          status: 'Scheduled',
          receipt: null,
        },
        {
          date: 'Sep 12, 2026 05:16',
          event: 'Renewed subscription plan',
          amountUsd: 50,
          status: 'Renewed',
          receipt: '/dashboard/billing/receipt/subscription/5e1f2ea1',
        },
        {
          date: 'Aug 12, 2026 04:15',
          event: 'Subscribed to Standard plan',
          amountUsd: 50,
          status: 'Active',
          receipt: '/dashboard/billing/receipt/subscription/1def8eec',
        },
      ],
      creditTransactions: [
        {
          date: 'Jul 08, 2026 22:48',
          type: 'Bonus',
          package: 'payment method bonus',
          amountUsd: 1,
          creditsUsd: 1,
          status: 'Completed',
          receipt: null,
        },
      ],
    },
    ...params,
  }
}

const NOW = () => new Date(2026, 9, 5)

const setup = setupNormalizeNeuralwattBilling

describe('normalizeNeuralwattBilling', () => {
  it('resolves the cycle from the quota subscription period', async () => {
    await using harness = await setup()

    const billing = await harness.normalizeNeuralwattBilling({
      capture: capture(),
      now: NOW(),
    })

    expect(billing).toMatchObject({
      provider: 'neuralwatt',
      cycleStart: '2026-09-12',
      cycleEnd: '2026-10-12',
    })
  })

  it('counts only the in-cycle renewal as the plan payment, converted at the shared FX constant', async () => {
    await using harness = await setup()

    const billing = await harness.normalizeNeuralwattBilling({
      capture: capture(),
      now: NOW(),
    })

    expect(billing.planPaymentAud).toBe(75)
    expect(billing.creditPurchasesAud).toBe(0)
  })

  it('charges no credit consumption while not in overage', async () => {
    await using harness = await setup()

    const billing = await harness.normalizeNeuralwattBilling({
      capture: capture(),
      now: NOW(),
    })

    expect(billing.creditPurchasesAud).toBe(0)
    expect(billing.creditsConsumedAud).toBe(0)
    expect(harness.fetchUsageSummary).not.toHaveBeenCalled()
  })

  it('prices overage energy at the metered rate when in overage', async () => {
    await using harness = await setup({
      fetchQuota: async () => ({
        subscription: {
          ...QUOTA.subscription,
          kwh_used: 7.25,
          in_overage: true,
        },
      }),
      fetchUsageSummary: async (params) => ({
        period: {
          start: `${params.startDate}T00:00:00Z`,
          end: `${params.endDate}T00:00:00Z`,
        },
        // 37.998856 ÷ 4.749857 = 8.0000 USD/kWh — matches 50 USD ÷ 6.25 kWh
        totals: { total_cost_usd: 37.998856, energy_kwh_charged: 4.749857 },
      }),
    })

    const billing = await harness.normalizeNeuralwattBilling({
      capture: capture(),
      now: NOW(),
    })

    // 1 kWh overage × 8 USD/kWh × 1.5 AUD/USD
    expect(billing.creditsConsumedAud).toBeCloseTo(12, 10)
  })

  it('fails when the metered rate disagrees with the plan rate', async () => {
    await using harness = await setup({
      fetchQuota: async () => ({
        subscription: {
          ...QUOTA.subscription,
          kwh_used: 7.25,
          in_overage: true,
        },
      }),
      fetchUsageSummary: async (params) => ({
        period: {
          start: `${params.startDate}T00:00:00Z`,
          end: `${params.endDate}T00:00:00Z`,
        },
        totals: { total_cost_usd: 10, energy_kwh_charged: 1 },
      }),
    })

    await expect(
      harness.normalizeNeuralwattBilling({ capture: capture(), now: NOW() })
    ).rejects.toThrow('disagrees with the plan rate')
  })

  it('reports whole-cycle utilization from charged energy against the included allowance', async () => {
    await using harness = await setup()

    const billing = await harness.normalizeNeuralwattBilling({
      capture: capture(),
      now: NOW(),
    })

    expect(billing.utilization).toEqual({
      basis: 'whole-cycle',
      fraction: 0.632784,
    })
  })

  it('derives native model shares from cycle-filtered per-model usage cost', async () => {
    await using harness = await setup({
      fetchUsageByModel: async (params) => ({
        period: {
          start: `${params.startDate}T00:00:00Z`,
          end: `${params.endDate}T00:00:00Z`,
        },
        products: [
          { requested_model: 'glm-5.2', total_tokens: 600, total_cost_usd: 60 },
          {
            requested_model: 'glm-5.2-air',
            total_tokens: 400,
            total_cost_usd: 40,
          },
        ],
      }),
    })

    const billing = await harness.normalizeNeuralwattBilling({
      capture: capture(),
      now: NOW(),
    })

    expect(billing.modelShares).toEqual([
      { model: 'glm-5.2', share: 0.6 },
      { model: 'glm-5.2-air', share: 0.4 },
    ])
    expect(harness.fetchUsageByModel).toHaveBeenCalledWith({
      startDate: '2026-09-12',
      endDate: '2026-10-05',
    })
  })

  it('falls back to per-model tokens when no usage cost is reported', async () => {
    await using harness = await setup({
      fetchUsageByModel: async (params) => ({
        period: {
          start: `${params.startDate}T00:00:00Z`,
          end: `${params.endDate}T00:00:00Z`,
        },
        products: [
          { requested_model: 'glm-5.2', total_tokens: 300, total_cost_usd: 0 },
          {
            requested_model: 'glm-5.2-air',
            total_tokens: 100,
            total_cost_usd: 0,
          },
        ],
      }),
    })

    const billing = await harness.normalizeNeuralwattBilling({
      capture: capture(),
      now: NOW(),
    })

    expect(billing.modelShares).toEqual([
      { model: 'glm-5.2', share: 0.75 },
      { model: 'glm-5.2-air', share: 0.25 },
    ])
  })

  it('rejects a usage period that does not match the requested cycle window', async () => {
    await using harness = await setup({
      fetchUsageByModel: async () => ({
        // silent fallback to the default 30-day window
        period: { start: '2026-09-05T00:00:00Z', end: '2026-10-05T00:00:00Z' },
        products: [],
      }),
    })

    await expect(
      harness.normalizeNeuralwattBilling({ capture: capture(), now: NOW() })
    ).rejects.toThrow('does not match the requested window')
  })

  it('fails fast when the quota has no active subscription', async () => {
    await using harness = await setup({
      fetchQuota: async () => ({
        subscription: null,
      }),
    })

    await expect(
      harness.normalizeNeuralwattBilling({ capture: capture(), now: NOW() })
    ).rejects.toThrow('no active subscription')
  })

  it('counts a renewal once when the cycle also contains a same-day subscribe event', async () => {
    await using harness = await setup()

    const billing = await harness.normalizeNeuralwattBilling({
      capture: capture({
        billing: {
          subscriptionBilling: [
            // one charge, two events — the subscribe shares the renewal's receipt
            {
              date: 'Sep 12, 2026 05:16',
              event: 'Subscribed to Standard plan',
              amountUsd: 50,
              status: 'Active',
              receipt: '/dashboard/billing/receipt/subscription/5e1f2ea1',
            },
            {
              date: 'Sep 12, 2026 05:16',
              event: 'Renewed subscription plan',
              amountUsd: 50,
              status: 'Renewed',
              receipt: '/dashboard/billing/receipt/subscription/5e1f2ea1',
            },
          ],
          creditTransactions: [],
        },
      }),
      now: NOW(),
    })

    expect(billing.planPaymentAud).toBe(75)
  })

  it('signals a stale capture when the live cycle has no renewal payment', async () => {
    await using harness = await setup()

    const error = await harness
      .normalizeNeuralwattBilling({
        capture: capture({
          billing: {
            subscriptionBilling: [
              {
                date: 'Sep 29, 2026 13:35',
                event: 'Downgrade to Basic scheduled',
                amountUsd: null,
                status: 'Scheduled',
                receipt: null,
              },
            ],
            creditTransactions: [],
          },
        }),
        now: NOW(),
      })
      .catch((thrown: unknown) => thrown)

    expect(error).toBeInstanceOf(StaleBillingCaptureError)
  })
})
