import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  fakeInvoice,
  fakeInvoicesPage,
  fakeNeuralwattBillingHtml,
  fakePrepaidCredits,
  fakePricingConfig,
  fakeSubscriptions,
  fakeTransaction,
  fakeTransactionHistoryPage,
} from './fakeBillingData'
import { extractBillingTables } from './neuralwatt/extractBillingTables'
import { loadCapture } from './loadCapture'

/** Writes a full hand-built capture directory: both paginated routes carry
 * two distinct 200 pages — a layout the capture flow never produces (the
 * default world ends invoices with a 422), which is exactly what the
 * loader's merge logic must handle. */
export async function setupLoadCapture() {
  const parent = await mkdtemp(join(tmpdir(), 'load-capture-harness-'))
  const dir = join(parent, 'capture')
  await mkdir(dir)
  const subscriptions = fakeSubscriptions()
  const pricingConfig = fakePricingConfig()
  const prepaidCredits = fakePrepaidCredits()
  const transaction1 = fakeTransaction()
  const transaction2 = fakeTransaction()
  const invoice1 = fakeInvoice()
  const invoice2 = fakeInvoice()
  const neuralwattBilling = extractBillingTables({
    html: fakeNeuralwattBillingHtml(),
  })
  const files: Array<[string, unknown]> = [
    ['chatgpt-subscriptions.json', subscriptions],
    [
      'chatgpt-transaction-history.page-001.json',
      fakeTransactionHistoryPage({
        transactions: [transaction1],
        nextCursor: 'p2',
      }),
    ],
    [
      'chatgpt-transaction-history.page-002.json',
      fakeTransactionHistoryPage({ transactions: [transaction2] }),
    ],
    ['chatgpt-pricing-config-aud.json', pricingConfig],
    [
      'anthropic-invoices.page-001.json',
      fakeInvoicesPage({ invoices: [invoice1], nextPage: '2' }),
    ],
    [
      'anthropic-invoices.page-002.json',
      fakeInvoicesPage({ invoices: [invoice2] }),
    ],
    ['anthropic-prepaid-credits.json', prepaidCredits],
    ['neuralwatt-billing.json', neuralwattBilling],
  ]
  for (const [name, body] of files) {
    await writeFile(join(dir, name), JSON.stringify(body))
  }
  return {
    dir,
    subscriptions,
    pricingConfig,
    prepaidCredits,
    transaction1,
    transaction2,
    invoice1,
    invoice2,
    neuralwattBilling,
    loadCapture: (params: { dir?: string } = {}) =>
      loadCapture({ dir, ...params }),
    async [Symbol.asyncDispose]() {
      await rm(parent, { recursive: true, force: true })
    },
  }
}
