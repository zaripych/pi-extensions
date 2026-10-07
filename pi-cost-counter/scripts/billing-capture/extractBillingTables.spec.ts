import { describe, expect, it } from 'vitest'
import { fakeNeuralwattBillingHtml } from './fakeBillingData'
import { extractBillingTables } from './neuralwatt/extractBillingTables'

describe('extractBillingTables', () => {
  it('normalizes both billing tables from the padded portal HTML', () => {
    const html = fakeNeuralwattBillingHtml({
      subscriptionRows: [
        {
          date: 'Sep 12, 2026 05:16',
          event: 'Renewed subscription plan',
          amount: '$50.00/mo',
          status: 'Renewed',
          receipt: '5e1f2ea1-7bd7-4f55-a566-b934576277d1',
        },
      ],
      creditRows: [
        {
          date: 'Jul 08, 2026 22:48',
          type: 'Bonus',
          package: 'payment method bonus',
          amount: '$1.00',
          credits: '$1.00',
          status: 'Completed',
          receipt: null,
        },
      ],
    })

    expect(extractBillingTables({ html })).toEqual({
      subscriptionBilling: [
        {
          date: 'Sep 12, 2026 05:16',
          event: 'Renewed subscription plan',
          amountUsd: 50,
          status: 'Renewed',
          receipt:
            '/dashboard/billing/receipt/subscription/5e1f2ea1-7bd7-4f55-a566-b934576277d1',
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
    })
  })

  it('maps "-" amounts and missing receipts to null', () => {
    const html = fakeNeuralwattBillingHtml({
      subscriptionRows: [
        {
          date: 'Aug 08, 2026 22:48',
          event: 'Cancelled Standard plan',
          amount: '-',
          status: 'Cancelled',
          receipt: null,
        },
      ],
      creditRows: [],
    })

    const tables = extractBillingTables({ html })

    expect(tables.subscriptionBilling).toEqual([
      {
        date: 'Aug 08, 2026 22:48',
        event: 'Cancelled Standard plan',
        amountUsd: null,
        status: 'Cancelled',
        receipt: null,
      },
    ])
    expect(tables.creditTransactions).toEqual([])
  })

  it('fails loudly when the billing table is missing', () => {
    expect(() => extractBillingTables({ html: '<html></html>' })).toThrow(
      'billing table not found: Subscription billing history'
    )
  })

  it('rejects a row whose date does not parse', () => {
    const html = fakeNeuralwattBillingHtml({
      subscriptionRows: [
        {
          date: 'not-a-date',
          event: 'Renewed subscription plan',
          amount: '$50.00/mo',
          status: 'Renewed',
          receipt: null,
        },
      ],
      creditRows: [],
    })

    expect(() => extractBillingTables({ html })).toThrow(
      'billing date does not parse'
    )
  })
})
