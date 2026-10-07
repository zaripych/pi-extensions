import { utimes, writeFile } from 'node:fs/promises'
import { faker } from '@faker-js/faker'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { setupLoadCapture } from './loadCapture.harness'
import { CHATGPT_ROUTES } from './openai/routes'
import { ANTHROPIC_ROUTES } from './anthropic/routes'
import { NEURALWATT_ROUTES } from './neuralwatt/routes'

const setup = setupLoadCapture
describe('loadCapture', () => {
  it('reads page files in order, merges items, and drops pagination fields', async () => {
    await using harness = await setup()

    const loaded = await harness.loadCapture()

    expect(loaded.openai.subscriptions).toEqual(harness.subscriptions)
    expect(loaded.openai.transactionHistory).toEqual({
      transactions: [harness.transaction1, harness.transaction2],
    })
    expect(loaded.openai.pricingConfig).toEqual(harness.pricingConfig)
    expect(loaded.anthropic.invoices).toEqual({
      invoices: [harness.invoice1, harness.invoice2],
    })
    expect(loaded.anthropic.prepaidCredits).toEqual(harness.prepaidCredits)
    expect(loaded.neuralwatt.billing).toEqual(harness.neuralwattBilling)
  })

  it('exposes every route-table key', async () => {
    await using harness = await setup()

    const loaded = await harness.loadCapture()

    expect(Object.keys(loaded.openai).toSorted()).toEqual(
      Object.keys(CHATGPT_ROUTES).toSorted()
    )
    expect(Object.keys(loaded.anthropic).toSorted()).toEqual(
      Object.keys(ANTHROPIC_ROUTES).toSorted()
    )
    expect(Object.keys(loaded.neuralwatt).toSorted()).toEqual(
      Object.keys(NEURALWATT_ROUTES).toSorted()
    )
  })

  it('reports the newest file mtime as capturedAt', async () => {
    await using harness = await setup()
    const newest = faker.date.future()

    await utimes(
      join(harness.dir, 'anthropic-prepaid-credits.json'),
      newest,
      newest
    )
    const loaded = await harness.loadCapture()

    expect(loaded.capturedAt).toEqual(newest)
  })

  it('rejects a hand-edited file that no longer matches its route schema', async () => {
    await using harness = await setup()

    await writeFile(
      join(harness.dir, 'chatgpt-subscriptions.json'),
      JSON.stringify({ wrong: true })
    )

    await expect(harness.loadCapture()).rejects.toThrow(
      'failed schema validation'
    )
  })

  it('rejects a missing capture directory', async () => {
    await using harness = await setup()

    await expect(
      harness.loadCapture({ dir: join(harness.dir, 'missing') })
    ).rejects.toThrow('ENOENT')
  })
})
