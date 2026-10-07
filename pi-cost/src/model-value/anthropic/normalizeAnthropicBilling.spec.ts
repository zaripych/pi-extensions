import { describe, expect, it } from 'vitest'
import type { loadCapture } from '../../billing-capture/loadCapture'
import { setupNormalizeAnthropicBilling } from './normalizeAnthropicBilling.harness'

type Capture = Awaited<ReturnType<typeof loadCapture>>
type AnthropicCapture = Capture['anthropic']

/** Inspected evidence: a 40 AUD prepaid grant one second before the
 * September 21 invoice of 44 AUD (40 AUD excluding 10% GST), and a 34 AUD
 * plan renewal on September 19. Midday UTC keeps local days unambiguous. */
function capture(params: Partial<AnthropicCapture> = {}): AnthropicCapture {
  return {
    invoices: {
      invoices: [
        {
          // credit purchase payment: 44 AUD on September 21
          created_ts: Date.parse('2026-09-21T12:00:00+00:00') / 1000,
          display_status_key: 'paid',
          total: 4400,
          total_excluding_tax: 4000,
          currency: 'aud',
        },
        {
          // current-cycle plan renewal: 34 AUD on September 19
          created_ts: Date.parse('2026-09-19T12:00:00+00:00') / 1000,
          display_status_key: 'paid',
          total: 3400,
          total_excluding_tax: 3091,
          currency: 'aud',
        },
        {
          // previous-cycle plan renewal: 34 AUD on August 19
          created_ts: Date.parse('2026-08-19T12:00:00+00:00') / 1000,
          display_status_key: 'paid',
          total: 3400,
          total_excluding_tax: 3091,
          currency: 'aud',
        },
      ],
    },
    prepaidCredits: {
      tranches: [
        {
          remaining_amount_minor_units: 3672,
          granted_amount_minor_units: 4000,
          granted_at: '2026-09-21T11:59:59+00:00',
          currency: 'aud',
        },
      ],
    },
    ...params,
  }
}

const setup = setupNormalizeAnthropicBilling

describe('normalizeAnthropicBilling', () => {
  it('resolves the cycle from the latest plan-payment invoice', async () => {
    await using harness = await setup()

    const billing = await harness.normalizeAnthropicBilling({
      capture: capture(),
    })

    expect(billing).toMatchObject({
      provider: 'anthropic',
      cycleStart: '2026-09-19',
      cycleEnd: '2026-10-19',
    })
  })

  it('classifies grant-backed invoices as credit purchases, not plan payments', async () => {
    await using harness = await setup()

    const billing = await harness.normalizeAnthropicBilling({
      capture: capture(),
    })

    expect(billing.planPaymentAud).toBe(34)
    expect(billing.creditPurchasesAud).toBe(44)
  })

  it('prices tax-exclusive tranche depletion at GST-inclusive cost', async () => {
    await using harness = await setup()

    const billing = await harness.normalizeAnthropicBilling({
      capture: capture(),
    })

    // 40 − 36.72 = 3.28 AUD tax-exclusive draw → 3.28 × 1.10 GST-inclusive
    expect(billing.creditsConsumedAud).toBeCloseTo(3.608, 10)
  })

  it('ignores depletion of tranches granted outside the cycle', async () => {
    await using harness = await setup()

    const billing = await harness.normalizeAnthropicBilling({
      capture: capture({
        prepaidCredits: {
          tranches: [
            {
              remaining_amount_minor_units: 0,
              granted_amount_minor_units: 4000,
              granted_at: '2026-08-02T11:59:59+00:00',
              currency: 'aud',
            },
          ],
        },
      }),
    })

    expect(billing.creditsConsumedAud).toBe(0)
  })

  it('uses the seven-day snapshot as elapsed-basis utilization', async () => {
    await using harness = await setup({
      fetchOauthUsage: async () => ({ seven_day: { utilization: 40 } }),
    })

    const billing = await harness.normalizeAnthropicBilling({
      capture: capture(),
    })

    expect(billing.utilization).toEqual({ basis: 'elapsed', fraction: 0.4 })
  })

  it('supplies no native model shares — token share is the allocation', async () => {
    await using harness = await setup()

    const billing = await harness.normalizeAnthropicBilling({
      capture: capture(),
    })

    expect(billing.modelShares).toBeNull()
  })

  it('excludes unpaid invoices from the cycle and payments', async () => {
    await using harness = await setup()

    await expect(
      harness.normalizeAnthropicBilling({
        capture: capture({
          invoices: {
            invoices: [
              {
                created_ts: Date.parse('2026-09-19T12:00:00+00:00') / 1000,
                display_status_key: 'open',
                total: 3400,
                total_excluding_tax: 3091,
                currency: 'aud',
              },
            ],
          },
        }),
      })
    ).rejects.toThrow('no paid Anthropic plan invoice')
  })

  it('fails fast when no paid plan invoice exists', async () => {
    await using harness = await setup()

    await expect(
      harness.normalizeAnthropicBilling({
        capture: capture({
          invoices: {
            invoices: [
              {
                created_ts: Date.parse('2026-09-21T12:00:00+00:00') / 1000,
                display_status_key: 'paid',
                total: 4400,
                total_excluding_tax: 4000,
                currency: 'aud',
              },
            ],
          },
        }),
      })
    ).rejects.toThrow('no paid Anthropic plan invoice')
  })
})
