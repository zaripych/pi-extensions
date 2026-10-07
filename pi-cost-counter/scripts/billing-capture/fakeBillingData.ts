import { faker } from '@faker-js/faker'
import type { RawResponse } from './fetchInPage'

export type FetchWorld = {
  routes: Record<string, RawResponse>
  chatgptAccountId?: string
  claudeOrgId?: string
  nextCursor?: string
}

export const subscriptionsKey = (world: FetchWorld) =>
  `/backend-api/subscriptions?account_id=${world.chatgptAccountId}`

export const historyKey = (world: FetchWorld) =>
  `/backend-api/payments/transaction-history?account_id=${world.chatgptAccountId}&limit=20`

export const historyPageKey = (world: FetchWorld) =>
  `${historyKey(world)}&cursor=${world.nextCursor}`

export const pricingKey = '/backend-api/checkout_pricing_config/configs/AUD'

export const invoicesKey = (world: FetchWorld) =>
  `/api/stripe/${world.claudeOrgId}/invoices?limit=50&page=`

export const prepaidCreditsKey = (world: FetchWorld) =>
  `/api/organizations/${world.claudeOrgId}/prepaid/credits`

export const neuralwattBillingKey = '/dashboard/billing'

export function ok(body: unknown): RawResponse {
  return { status: 200, body: JSON.stringify(body) }
}

export function fakeSubscriptions() {
  return {
    plan_type: faker.string.sample(8),
    entitlement: { renews_at: faker.date.future().toISOString() },
  }
}

export function fakeTransaction() {
  return {
    created_at: faker.date.recent({ days: 1 }).toISOString(),
    product: { type: 'credits_top_up' },
    status: 'paid',
    amount: faker.number.int({ min: 100, max: 100_000 }),
    currency: 'aud',
  }
}

export function fakeTransactionHistoryPage(
  params: {
    transactions?: Array<ReturnType<typeof fakeTransaction>>
    nextCursor?: string
  } = {}
) {
  return {
    transactions: params.transactions ?? [fakeTransaction()],
    next_cursor: params.nextCursor,
  }
}

export function fakePricingConfig() {
  return {
    currency_config: {
      amount_per_credit: faker.number.float({ min: 0.01, max: 1 }),
      [faker.string.sample(8)]: {
        month: { amount: faker.number.int({ min: 100, max: 10_000 }) },
      },
    },
  }
}

export function fakeInvoice() {
  return {
    created_ts: Math.floor(faker.date.recent({ days: 1 }).getTime() / 1000),
    display_status_key: 'paid',
    total: faker.number.int({ min: 100, max: 100_000 }),
    total_excluding_tax: faker.number.int({ min: 100, max: 100_000 }),
    currency: 'aud',
  }
}

export function fakeInvoicesPage(
  params: {
    invoices?: Array<ReturnType<typeof fakeInvoice>>
    nextPage?: string
  } = {}
) {
  return {
    invoices: params.invoices ?? [fakeInvoice()],
    next_page: params.nextPage,
  }
}

export function fakeTranche() {
  const granted = faker.number.int({ min: 0, max: 100_000 })
  return {
    remaining_amount_minor_units: faker.number.int({ min: 0, max: granted }),
    granted_amount_minor_units: granted,
    granted_at: faker.date.recent({ days: 1 }).toISOString(),
    currency: 'aud',
  }
}

export function fakePrepaidCredits() {
  return { tranches: [fakeTranche()] }
}

const NEURALWATT_MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
]

function neuralwattDate(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${NEURALWATT_MONTHS[date.getMonth()]} ${pad(date.getDate())}, ${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function fakeNeuralwattSubscriptionRow() {
  return {
    date: neuralwattDate(faker.date.recent({ days: 90 })),
    event: faker.helpers.arrayElement([
      'Renewed subscription plan',
      'Cancelled Standard plan',
      'Downgrade to Basic scheduled',
    ]),
    amount: faker.helpers.arrayElement(['$50.00/mo', '-']),
    status: faker.helpers.arrayElement([
      'Renewed',
      'Active',
      'Cancelled',
      'Scheduled',
    ]),
    receipt: faker.helpers.arrayElement([faker.string.uuid(), null]),
  }
}

export function fakeNeuralwattCreditRow() {
  const dollars = faker.number.int({ min: 1, max: 100 })
  return {
    date: neuralwattDate(faker.date.recent({ days: 90 })),
    type: faker.helpers.arrayElement(['Bonus', 'Purchase']),
    package: 'payment method bonus',
    amount: `$${dollars}.00`,
    credits: `$${dollars}.00`,
    status: 'Completed',
    receipt: null,
  }
}

const subscriptionReceiptCell = (receipt: string | null) =>
  receipt === null
    ? '<span class="text-nw-fg3">-</span>'
    : `<a href="/dashboard/billing/receipt/subscription/${receipt}">View</a>`

/** Mirrors the padded Jinja markup of the real billing page: cells carry
 * surrounding whitespace, receipts are anchors or "-" placeholders, and
 * each table hangs off a scroll region whose aria-label names it. */
export function fakeNeuralwattBillingHtml(
  params: {
    subscriptionRows?: Array<ReturnType<typeof fakeNeuralwattSubscriptionRow>>
    creditRows?: Array<ReturnType<typeof fakeNeuralwattCreditRow>>
  } = {}
): string {
  const subscriptionRows = params.subscriptionRows ?? [
    fakeNeuralwattSubscriptionRow(),
  ]
  const creditRows = params.creditRows ?? [fakeNeuralwattCreditRow()]
  const row = (cells: string[]) =>
    `<tr>
${cells
  .map(
    (cell) => `            <td class="whitespace-nowrap">
              ${cell}
            </td>`
  )
  .join('')}
          </tr>`
  const table = (label: string, headers: string[], rows: string[][]) =>
    `<div class="relative" data-hscroll>
        <div class="overflow-x-auto nw-hscroll" tabindex="0" role="region"
             aria-label="${label}, scrollable horizontally">
            <table class="nw-table">
                <thead>
                    <tr>${headers.map((header) => `<th>${header}</th>`).join('')}</tr>
                </thead>
                <tbody>
                    ${rows.map(row).join(`
                    `)}
                </tbody>
            </table>
        </div>
    </div>`
  return `<!DOCTYPE html>
<html lang="en"><body>
    ${table(
      'Subscription billing history',
      ['Date', 'Event', 'Amount', 'Status', 'Receipt'],
      subscriptionRows.map((entry) => [
        entry.date,
        entry.event,
        entry.amount,
        `<span class="nw-tag nw-tag-sm nw-tag-green">${entry.status}</span>`,
        subscriptionReceiptCell(entry.receipt),
      ])
    )}
    ${table(
      'Credit transaction history',
      ['Date', 'Type', 'Package', 'Amount', 'Credits', 'Status', 'Receipt'],
      creditRows.map((entry) => [
        entry.date,
        `<span class="nw-tag nw-tag-sm nw-tag-moss">${entry.type}</span>`,
        entry.package,
        entry.amount,
        entry.credits,
        `<span class="nw-tag nw-tag-sm nw-tag-green">${entry.status}</span>`,
        '<span class="text-nw-fg3">-</span>',
      ])
    )}
</body></html>`
}

export function fakeFetchWorld(
  params: { overrides?: Record<string, RawResponse> } = {}
): FetchWorld {
  const chatgptAccountId = faker.string.uuid()
  const claudeOrgId = faker.string.uuid()
  const nextCursor = faker.string.alphanumeric(8)
  const nextPage = String(faker.number.int({ min: 2, max: 9 }))
  const world: FetchWorld = {
    routes: {},
    chatgptAccountId,
    claudeOrgId,
    nextCursor,
  }
  world.routes = {
    '/api/auth/session': ok({
      accessToken: faker.string.alphanumeric(32),
      account: { id: chatgptAccountId },
    }),
    '/api/organizations': ok({ organizations: [{ uuid: claudeOrgId }] }),
    [subscriptionsKey(world)]: ok(fakeSubscriptions()),
    [historyKey(world)]: ok(fakeTransactionHistoryPage({ nextCursor })),
    [historyPageKey(world)]: ok(
      fakeTransactionHistoryPage({ transactions: [] })
    ),
    [pricingKey]: ok(fakePricingConfig()),
    [invoicesKey(world)]: ok(fakeInvoicesPage({ nextPage })),
    [`${invoicesKey(world)}${nextPage}`]: {
      status: 422,
      body: 'past the last page',
    },
    [prepaidCreditsKey(world)]: ok(fakePrepaidCredits()),
    [neuralwattBillingKey]: { status: 200, body: fakeNeuralwattBillingHtml() },
    ...params.overrides,
  }
  return world
}
