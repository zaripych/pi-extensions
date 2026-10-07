import { z } from 'zod'
import { defineRoute } from '../fetchWithPagination'

const subscriptionsBody = z.object({
  plan_type: z.string(),
  // renewal evidence — anchors the current billing cycle
  entitlement: z.object({
    renews_at: z
      .string()
      .refine((value) => Number.isFinite(Date.parse(value)), {
        message: 'renews_at does not parse to a date',
      }),
  }),
})

const transactionHistoryBody = z.object({
  transactions: z.array(
    z.object({
      // NaN from an unparseable date would poison the cutoff detection
      created_at: z
        .string()
        .refine((value) => Number.isFinite(Date.parse(value)), {
          message: 'created_at does not parse to a date',
        }),
      product: z.object({ type: z.string() }),
      status: z.string(),
      amount: z.number(),
      currency: z.string(),
    })
  ),
  next_cursor: z.string().nullish(),
})

const pricingConfigBody = z.object({
  // amount_per_credit is AUD, GST-inclusive — used to price consumed
  // credits, never as payment evidence
  currency_config: z.looseObject({ amount_per_credit: z.number() }),
})

export const CHATGPT_ROUTES = {
  subscriptions: defineRoute({
    path: '/backend-api/subscriptions?account_id={account}',
    file: 'chatgpt-subscriptions',
    schema: subscriptionsBody,
  }),
  transactionHistory: defineRoute({
    path: '/backend-api/payments/transaction-history?account_id={account}&limit=20',
    file: 'chatgpt-transaction-history',
    schema: transactionHistoryBody,
    paginate: {
      items: (page) => page.transactions,
      itemDateMs: (item) => Date.parse(item.created_at),
      cursor: (page) => page.next_cursor,
      nextUrl: ({ url, cursor }) =>
        `${url}&cursor=${encodeURIComponent(cursor)}`,
    },
  }),
  pricingConfig: defineRoute({
    path: '/backend-api/checkout_pricing_config/configs/AUD',
    file: 'chatgpt-pricing-config-aud',
    schema: pricingConfigBody,
  }),
}
