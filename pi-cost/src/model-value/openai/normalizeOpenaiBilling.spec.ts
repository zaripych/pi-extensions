import { describe, expect, it } from 'vitest'
import type { loadCapture } from '../../billing-capture/loadCapture'
import { setupNormalizeOpenaiBilling } from './normalizeOpenaiBilling.harness'

type Capture = Awaited<ReturnType<typeof loadCapture>>
type OpenaiCapture = Capture['openai']

/** 2026-10-11T12:00:00Z — midday UTC so the local day is unambiguous on
 * this machine (AEST/AEDT). */
const RENEWS_AT = '2026-10-11T12:00:00+00:00'
/** Observation time: 2026-09-21 local, 10 days into the Sep 11 cycle. */
const NOW = () => new Date(2026, 8, 21)

function capture(params: Partial<OpenaiCapture> = {}): OpenaiCapture {
  return {
    subscriptions: { plan_type: 'plus', entitlement: { renews_at: RENEWS_AT } },
    transactionHistory: {
      transactions: [
        {
          // current-cycle plan payment: 30 AUD on September 11
          created_at: '2026-09-11T12:00:00+00:00',
          product: { type: 'subscription' },
          status: 'paid',
          amount: 3000,
          currency: 'aud',
        },
        {
          // current-cycle credit purchase: 51.98 AUD on September 29
          created_at: '2026-09-29T12:00:00+00:00',
          product: { type: 'credits_top_up' },
          status: 'paid',
          amount: 5198,
          currency: 'aud',
        },
        {
          // previous-cycle credit purchase: 66.83 AUD on September 8
          created_at: '2026-09-08T12:00:00+00:00',
          product: { type: 'credits_top_up' },
          status: 'paid',
          amount: 6683,
          currency: 'aud',
        },
      ],
    },
    pricingConfig: {
      currency_config: {
        amount_per_credit: 0.06,
        plus: { month: { amount: 30 } },
      },
    },
    ...params,
  }
}

const setup = setupNormalizeOpenaiBilling

describe('normalizeOpenaiBilling', () => {
  it('resolves the cycle from the subscription renewal date', async () => {
    await using harness = await setup()

    const billing = await harness.normalizeOpenaiBilling({
      capture: capture(),
      now: NOW(),
    })

    expect(billing).toMatchObject({
      provider: 'openai',
      cycleStart: '2026-09-11',
      cycleEnd: '2026-10-11',
    })
  })

  it('counts only in-cycle paid transactions as plan payment and credit purchases', async () => {
    await using harness = await setup()

    const billing = await harness.normalizeOpenaiBilling({
      capture: capture(),
      now: NOW(),
    })

    expect(billing.planPaymentAud).toBe(30)
    expect(billing.creditPurchasesAud).toBe(51.98)
  })

  it('converts non-AUD transaction amounts with the shared FX constant', async () => {
    await using harness = await setup()

    const billing = await harness.normalizeOpenaiBilling({
      capture: capture({
        transactionHistory: {
          transactions: [
            {
              created_at: '2026-09-11T12:00:00+00:00',
              product: { type: 'subscription' },
              status: 'paid',
              amount: 2000,
              currency: 'usd',
            },
          ],
        },
      }),
      now: NOW(),
    })

    expect(billing.planPaymentAud).toBe(30)
  })

  it('ignores unpaid transactions', async () => {
    await using harness = await setup()

    await expect(
      harness.normalizeOpenaiBilling({
        capture: capture({
          transactionHistory: {
            transactions: [
              {
                created_at: '2026-09-11T12:00:00+00:00',
                product: { type: 'subscription' },
                status: 'pending',
                amount: 3000,
                currency: 'aud',
              },
            ],
          },
        }),
        now: NOW(),
      })
    ).rejects.toThrow('no paid OpenAI subscription payment')
  })

  it('clamps the cycle start at the end of a short month', async () => {
    await using harness = await setup()

    const billing = await harness.normalizeOpenaiBilling({
      capture: capture({
        subscriptions: {
          plan_type: 'plus',
          entitlement: { renews_at: '2026-03-31T12:00:00+00:00' },
        },
        transactionHistory: {
          transactions: [
            {
              // a March 31 renewal must resolve to February 28, not March 3
              created_at: '2026-02-28T12:00:00+00:00',
              product: { type: 'subscription' },
              status: 'paid',
              amount: 3000,
              currency: 'aud',
            },
          ],
        },
      }),
      now: NOW(),
    })

    expect(billing).toMatchObject({
      cycleStart: '2026-02-28',
      cycleEnd: '2026-03-31',
    })
    expect(billing.planPaymentAud).toBe(30)
  })

  it('fails fast when no paid subscription payment exists in the cycle', async () => {
    await using harness = await setup()

    await expect(
      harness.normalizeOpenaiBilling({
        capture: capture({
          transactionHistory: {
            transactions: [
              {
                created_at: '2026-09-29T12:00:00+00:00',
                product: { type: 'credits_top_up' },
                status: 'paid',
                amount: 5198,
                currency: 'aud',
              },
            ],
          },
        }),
        now: NOW(),
      })
    ).rejects.toThrow('no paid OpenAI subscription payment')
  })

  it('derives elapsed-basis utilization from the daily breakdown percentages', async () => {
    await using harness = await setup({
      fetchDailyUsageBreakdown: async () => ({
        data: [
          // days Sep 11..Sep 20: percentages of the daily-reset allowance
          { date: '2026-09-11', models: [] },
          { date: '2026-09-12', models: [] },
          {
            date: '2026-09-13',
            models: [{ model: 'gpt-6-astra', credits: 50 }],
          },
          {
            date: '2026-09-14',
            models: [{ model: 'gpt-6-astra', credits: 50 }],
          },
          { date: '2026-09-15', models: [] },
          { date: '2026-09-16', models: [] },
          {
            date: '2026-09-17',
            models: [{ model: 'gpt-6-astra', credits: 100 }],
          },
          { date: '2026-09-18', models: [] },
          {
            date: '2026-09-19',
            models: [{ model: 'gpt-6-astra', credits: 25 }],
          },
          {
            date: '2026-09-20',
            models: [{ model: 'gpt-6-astra', credits: 75 }],
          },
        ],
      }),
    })

    const billing = await harness.normalizeOpenaiBilling({
      capture: capture(),
      now: NOW(),
    })

    expect(billing.utilization).toEqual({ basis: 'elapsed', fraction: 0.3 })
  })

  it('fails fast when the breakdown covers no cycle days', async () => {
    await using harness = await setup({
      fetchDailyUsageBreakdown: async () => ({
        data: [
          {
            date: '2026-08-01',
            models: [{ model: 'gpt-6-astra', credits: 50 }],
          },
        ],
      }),
    })

    await expect(
      harness.normalizeOpenaiBilling({ capture: capture(), now: NOW() })
    ).rejects.toThrow('covers no days of cycle')
  })

  it('requests the breakdown for the cycle window observed so far', async () => {
    await using harness = await setup()

    await harness.normalizeOpenaiBilling({ capture: capture(), now: NOW() })

    expect(harness.fetchDailyUsageBreakdown).toHaveBeenCalledWith({
      startDate: '2026-09-11',
      endDate: '2026-09-21',
    })
  })

  it('prices consumed credits from the captured per-credit price', async () => {
    await using harness = await setup({
      fetchCreditUsageEvents: async () => ({
        data: [
          { date: '2026-09-15', credit_amount: 50 },
          { date: '2026-09-20', credit_amount: 25 },
          { date: '2026-09-21', credit_amount: 25 },
          // before the cycle and after the observation time: excluded
          { date: '2026-09-08', credit_amount: 100 },
          { date: '2026-09-22', credit_amount: 100 },
        ],
      }),
    })

    const billing = await harness.normalizeOpenaiBilling({
      capture: capture(),
      now: NOW(),
    })

    expect(billing.creditsConsumedAud).toBeCloseTo(100 * 0.06, 10)
  })

  it('derives native model shares from daily per-model attribution', async () => {
    await using harness = await setup({
      fetchDailyUsageBreakdown: async () => ({
        data: [
          {
            date: '2026-09-13',
            models: [
              { model: 'gpt-6-astra', credits: 75 },
              { model: 'gpt-5.6-sol', credits: 25 },
            ],
          },
          {
            date: '2026-09-14',
            models: [{ model: 'gpt-6-astra', credits: 100 }],
          },
        ],
      }),
    })

    const billing = await harness.normalizeOpenaiBilling({
      capture: capture(),
      now: NOW(),
    })

    expect(billing.modelShares).toEqual([
      { model: 'gpt-6-astra', share: 0.875 },
      { model: 'gpt-5.6-sol', share: 0.125 },
    ])
  })

  it('supplies no native shares when no usage is attributed', async () => {
    await using harness = await setup({
      fetchDailyUsageBreakdown: async () => ({
        data: [{ date: '2026-09-13', models: [] }],
      }),
    })

    const billing = await harness.normalizeOpenaiBilling({
      capture: capture(),
      now: NOW(),
    })

    expect(billing.modelShares).toBeNull()
  })
})
