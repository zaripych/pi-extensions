import { parse as parseHtml, type HTMLElement } from 'node-html-parser'
import { z } from 'zod'

const dateString = z
  .string()
  .refine((value) => Number.isFinite(Date.parse(value)), {
    message: 'billing date does not parse',
  })

const subscriptionBillingRow = z.object({
  date: dateString,
  event: z.string(),
  amountUsd: z.number().nullable(),
  status: z.string(),
  receipt: z.string().nullable(),
})

const creditTransactionRow = z.object({
  date: dateString,
  type: z.string(),
  package: z.string(),
  amountUsd: z.number().nullable(),
  creditsUsd: z.number().nullable(),
  status: z.string(),
  receipt: z.string().nullable(),
})

export const billingTablesBody = z.object({
  subscriptionBilling: z.array(subscriptionBillingRow),
  creditTransactions: z.array(creditTransactionRow),
})

export type BillingTables = z.infer<typeof billingTablesBody>

/** Finds each billing table by its scroll region's aria-label — semantic
 * copy, unlike the Tailwind class chain around it — and maps tbody rows to
 * normalized values. No type assertions: construction is explicit and
 * billingTablesBody.parse proves the result. */
export function extractBillingTables(params: { html: string }): BillingTables {
  const root = parseHtml(params.html)
  return billingTablesBody.parse({
    subscriptionBilling: tableRows({
      table: tableFor({ root, label: 'Subscription billing history' }),
    }).map(subscriptionBillingEntry),
    creditTransactions: tableRows({
      table: tableFor({ root, label: 'Credit transaction history' }),
    }).map(creditTransactionEntry),
  })
}

function tableFor(params: { root: HTMLElement; label: string }): HTMLElement {
  const region = params.root
    .querySelectorAll('[aria-label]')
    .find((el) => (el.getAttribute('aria-label') ?? '').includes(params.label))
  const table = region?.querySelector('table')
  if (!table) throw new Error(`billing table not found: ${params.label}`)
  return table
}

type RowCells = { texts: string[]; receipt: string | null }

function tableRows(params: { table: HTMLElement }): RowCells[] {
  return params.table.querySelectorAll('tbody tr').map((tr) => {
    const cells = tr.querySelectorAll('td')
    return {
      texts: cells.map((td) => td.text.trim()),
      // only the receipt column carries an anchor; "-" cells have none
      receipt:
        cells
          .map((td) => td.querySelector('a')?.getAttribute('href'))
          .find(Boolean) ?? null,
    }
  })
}

function subscriptionBillingEntry(cells: RowCells) {
  return {
    date: cells.texts[0] ?? '',
    event: cells.texts[1] ?? '',
    amountUsd: amountUsdOf(cells.texts[2]),
    status: cells.texts[3] ?? '',
    receipt: cells.receipt,
  }
}

function creditTransactionEntry(cells: RowCells) {
  return {
    date: cells.texts[0] ?? '',
    type: cells.texts[1] ?? '',
    package: cells.texts[2] ?? '',
    amountUsd: amountUsdOf(cells.texts[3]),
    creditsUsd: amountUsdOf(cells.texts[4]),
    status: cells.texts[5] ?? '',
    receipt: cells.receipt,
  }
}

/** "$50.00/mo" and "$1.00" → 50 and 1; "-" and anything unmatched → null. */
function amountUsdOf(text: string | undefined): number | null {
  if (!text || text === '-') return null
  const amount = /\$([\d,]+(?:\.\d+)?)/.exec(text)?.[1]
  return amount ? Number(amount.replace(/,/g, '')) : null
}
