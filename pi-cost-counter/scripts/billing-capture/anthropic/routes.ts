import { z } from 'zod'
import { defineRoute } from '../fetchWithPagination'

const invoicesBody = z.object({
  invoices: z.array(
    z.object({
      created_ts: z.number(),
      display_status_key: z.string(),
      total: z.number(),
      total_excluding_tax: z.number(),
      currency: z.string(),
    })
  ),
  next_page: z.string().nullish(),
})

const prepaidCreditsBody = z.object({
  tranches: z.array(
    z.object({
      remaining_amount_minor_units: z.number(),
      granted_amount_minor_units: z.number(),
      granted_at: z
        .string()
        .refine((value) => Number.isFinite(Date.parse(value)), {
          message: 'granted_at does not parse to a date',
        }),
      currency: z.string(),
    })
  ),
})

export const ANTHROPIC_ROUTES = {
  invoices: defineRoute({
    path: '/api/stripe/{org}/invoices?limit=50&page=',
    file: 'anthropic-invoices',
    schema: invoicesBody,
    paginate: {
      items: (page) => page.invoices,
      itemDateMs: (item) => item.created_ts * 1000,
      cursor: (page) => page.next_page,
      nextUrl: ({ url, cursor }) => `${url}${cursor}`,
      endOfPagesStatuses: [422],
    },
  }),
  prepaidCredits: defineRoute({
    path: '/api/organizations/{org}/prepaid/credits',
    file: 'anthropic-prepaid-credits',
    schema: prepaidCreditsBody,
  }),
}
