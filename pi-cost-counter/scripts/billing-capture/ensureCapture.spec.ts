import { readFile, readdir, utimes } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { combineHarnesses } from 'foundation/testing/harness/combineHarnesses'
import {
  fakeFetchWorld,
  fakeSubscriptions,
  fakeTransaction,
  fakeTransactionHistoryPage,
  historyKey,
  historyPageKey,
  invoicesKey,
  neuralwattBillingKey,
  ok,
  prepaidCreditsKey,
  pricingKey,
  subscriptionsKey,
} from './fakeBillingData'
import { extractBillingTables } from './neuralwatt/extractBillingTables'
import { setupEnsureCapture } from './ensureCapture.harness'

const setup = combineHarnesses(setupEnsureCapture)

/** Touches every published file two days back, past the freshness window. */
async function agePastFreshness({ dir }: { dir: string }) {
  const stale = new Date(Date.now() - 2 * 24 * 3_600_000)
  for (const file of await readdir(dir)) {
    await utimes(join(dir, file), stale, stale)
  }
}

describe('ensureCapture', () => {
  it('returns the cached capture unchanged when refresh is not forced', async () => {
    await using harness = await setup()
    const { world } = harness

    const first = await harness.ensureCapture({
      now: new Date(),
      forceRefresh: true,
    })
    // narrow the type, so we can reference first.data later
    if (!first.ok) throw new Error('first capture failed')
    world.routes[subscriptionsKey(world)] = ok(fakeSubscriptions())
    const result = await harness.ensureCapture({ now: new Date() })

    expect(result).toEqual({ ok: true, data: first.data })
  })

  it('makes a missing capture available after a successful refresh', async () => {
    await using harness = await setup()
    const { world } = harness
    await expect(harness.loadCapture()).rejects.toThrow(
      'no such file or directory'
    )

    const result = await harness.ensureCapture({ now: new Date() })

    expect(result.ok).toBe(true)
    expect(result).toEqual({ ok: true, data: await harness.loadCapture() })
    const published: Record<string, string> = {}
    for (const file of await readdir(harness.captureDir)) {
      published[file] = await readFile(join(harness.captureDir, file), 'utf8')
    }
    expect(published).toEqual({
      'chatgpt-subscriptions.json': world.routes[subscriptionsKey(world)]?.body,
      'chatgpt-transaction-history.page-001.json':
        world.routes[historyKey(world)]?.body,
      'chatgpt-transaction-history.page-002.json':
        world.routes[historyPageKey(world)]?.body,
      'chatgpt-pricing-config-aud.json': world.routes[pricingKey]?.body,
      'anthropic-invoices.page-001.json':
        world.routes[invoicesKey(world)]?.body,
      'anthropic-prepaid-credits.json':
        world.routes[prepaidCreditsKey(world)]?.body,
      'neuralwatt-billing.json': JSON.stringify(
        extractBillingTables({
          html: world.routes[neuralwattBillingKey]?.body ?? '',
        }),
        null,
        2
      ),
    })
  })

  it('replaces a stale capture with updated billing records', async () => {
    await using harness = await setup()
    const { world } = harness
    const subscriptions = fakeSubscriptions()

    await harness.capture({})
    await agePastFreshness({ dir: harness.captureDir })
    world.routes[subscriptionsKey(world)] = ok(subscriptions)
    const result = await harness.ensureCapture({ now: new Date() })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('refresh failed')
    expect(result.data.openai.subscriptions).toEqual(subscriptions)
    expect(result.data.capturedAt.getTime()).toBeGreaterThan(
      Date.now() - 60_000
    )
  })

  it('replaces fresh records when refresh is forced', async () => {
    await using harness = await setup()
    const { world } = harness
    const subscriptions = fakeSubscriptions()

    await harness.capture({})
    world.routes[subscriptionsKey(world)] = ok(subscriptions)
    const result = await harness.ensureCapture({
      now: new Date(),
      forceRefresh: true,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('refresh failed')
    expect(result.data.openai.subscriptions).toEqual(subscriptions)
  })

  it('merges multi-page responses in page order without pagination fields', async () => {
    await using harness = await setup()
    const { world } = harness

    const result = await harness.ensureCapture({
      now: new Date(),
      forceRefresh: true,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('refresh failed')
    const firstPage = JSON.parse(world.routes[historyKey(world)]?.body ?? '{}')
    const secondPage = JSON.parse(
      world.routes[historyPageKey(world)]?.body ?? '{}'
    )
    expect(result.data.openai.transactionHistory).toEqual({
      transactions: [...firstPage.transactions, ...secondPage.transactions],
    })
  })

  it('removes leftover pages when a refresh yields fewer pages', async () => {
    await using harness = await setup()
    const { world } = harness
    const singlePage = fakeTransactionHistoryPage({
      transactions: [fakeTransaction()],
    })

    world.routes[historyPageKey(world)] = ok(
      fakeTransactionHistoryPage({ transactions: [fakeTransaction()] })
    )
    await harness.capture({})
    world.routes[historyKey(world)] = ok(singlePage)
    const result = await harness.ensureCapture({
      now: new Date(),
      forceRefresh: true,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('refresh failed')
    expect(result.data.openai.transactionHistory).toEqual({
      transactions: singlePage.transactions,
    })
  })

  it('keeps the previous records when a route fails during refresh', async () => {
    await using harness = await setup()
    const { world } = harness

    const first = await harness.ensureCapture({
      now: new Date(),
      forceRefresh: true,
    })
    world.routes[pricingKey] = { status: 500, body: 'boom' }
    const result = await harness.ensureCapture({
      now: new Date(),
      forceRefresh: true,
    })

    expect(result).toEqual({
      ok: false,
      failure: expect.objectContaining({ ok: false, needsLogin: false }),
    })
    if (result.ok) throw new Error('expected the refresh to fail')
    const manifest = JSON.parse(
      await readFile(
        join(result.failure.artifactsPath, 'manifest.json'),
        'utf8'
      )
    )
    expect(manifest).toEqual(
      expect.objectContaining({
        chatgptAccountId: world.chatgptAccountId,
        claudeOrgId: world.claudeOrgId,
        probes: {
          chatgptSessionStatus: 200,
          claudeOrganizationsStatus: 200,
          neuralwattBillingStatus: 200,
        },
        routes: {
          'chatgpt-subscriptions': expect.objectContaining({ status: 200 }),
          'chatgpt-transaction-history': expect.objectContaining({
            status: 200,
            stopReason: 'exhausted',
          }),
          'chatgpt-pricing-config-aud': expect.objectContaining({
            status: 'error',
            error: expect.stringContaining(
              'route /backend-api/checkout_pricing_config/configs/AUD answered 500'
            ),
          }),
          'anthropic-invoices': expect.objectContaining({
            status: 200,
            stopReason: 'end-of-pages',
          }),
          'anthropic-prepaid-credits': expect.objectContaining({ status: 200 }),
          'neuralwatt-billing': expect.objectContaining({ status: 200 }),
        },
      })
    )
    if (!first.ok) throw new Error('first capture failed')
    expect(await harness.loadCapture()).toEqual(first.data)
  })

  it('keeps the previous records when a response is invalid', async () => {
    await using harness = await setup()
    const { world } = harness

    const first = await harness.ensureCapture({
      now: new Date(),
      forceRefresh: true,
    })
    world.routes[pricingKey] = {
      status: 200,
      body: JSON.stringify({ wrong: true }),
    }
    const result = await harness.ensureCapture({
      now: new Date(),
      forceRefresh: true,
    })

    expect(result).toEqual({
      ok: false,
      failure: expect.objectContaining({ ok: false, needsLogin: false }),
    })
    if (!first.ok) throw new Error('first capture failed')
    expect(await harness.loadCapture()).toEqual(first.data)
  })

  it('rejects transactions with unparseable timestamps', async () => {
    await using harness = await setup()
    const { world } = harness
    const invalidTransaction = {
      ...fakeTransaction(),
      created_at: 'not-a-date',
    }

    world.routes[historyKey(world)] = ok(
      fakeTransactionHistoryPage({ transactions: [invalidTransaction] })
    )
    const result = await harness.ensureCapture({
      now: new Date(),
      forceRefresh: true,
    })

    expect(result).toEqual({
      ok: false,
      failure: expect.objectContaining({ ok: false, needsLogin: false }),
    })
  })

  it('leaves no loadable capture when the first capture fails', async () => {
    await using harness = await setup({
      fakeFetchWorld: () =>
        fakeFetchWorld({
          overrides: { [pricingKey]: { status: 500, body: 'boom' } },
        }),
    })

    const result = await harness.ensureCapture({ now: new Date() })

    expect(result).toEqual({
      ok: false,
      failure: expect.objectContaining({ ok: false, needsLogin: false }),
    })
    await expect(harness.loadCapture()).rejects.toThrow(
      'no such file or directory'
    )
  })

  it('completes the login when Enter is supplied after logging in', async () => {
    await using harness = await setup()
    const { world } = harness
    const session = world.routes['/api/auth/session']
    if (!session) throw new Error('session fixture missing')

    world.routes['/api/auth/session'] = { status: 401, body: 'unauthenticated' }
    harness.waitForEnter.mockImplementation(async () => {
      world.routes['/api/auth/session'] = session
    })
    const result = await harness.ensureCapture({ now: new Date() })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('refresh failed')
    expect(result.data.openai.subscriptions).toEqual(
      JSON.parse(world.routes[subscriptionsKey(world)]?.body ?? '{}')
    )
  })

  it('reports needsLogin without prompting when the terminal is non-interactive', async () => {
    await using harness = await setup({
      fakeFetchWorld: () =>
        fakeFetchWorld({
          overrides: {
            '/api/auth/session': { status: 401, body: 'unauthenticated' },
          },
        }),
      isInteractiveTerminal: () => false,
      waitForEnter: async () => {
        throw new Error('must not prompt on a non-interactive terminal')
      },
    })

    const result = await harness.ensureCapture({ now: new Date() })

    expect(result).toEqual({
      ok: false,
      failure: expect.objectContaining({ ok: false, needsLogin: true }),
    })
    if (result.ok) throw new Error('expected the capture to need login')
    await expect(
      readFile(
        join(result.failure.artifactsPath, 'probe-chatgpt-session.json'),
        'utf8'
      )
    ).resolves.toBe('unauthenticated')
  })

  it('reports needsLogin when the session answers without credentials', async () => {
    await using harness = await setup({
      fakeFetchWorld: () =>
        fakeFetchWorld({
          overrides: { '/api/auth/session': ok({}) },
        }),
      isInteractiveTerminal: () => false,
      waitForEnter: async () => {
        throw new Error('must not prompt on a non-interactive terminal')
      },
    })

    const result = await harness.ensureCapture({ now: new Date() })

    expect(result).toEqual({
      ok: false,
      failure: expect.objectContaining({ ok: false, needsLogin: true }),
    })
  })

  it('produces the same records through an attached and a launched session', async () => {
    await using harness = await setup()

    const attached = await harness.ensureCapture({
      now: new Date(),
      forceRefresh: true,
      port: harness.port,
    })
    const launched = await harness.ensureCapture({
      now: new Date(),
      forceRefresh: true,
    })

    expect(attached.ok).toBe(true)
    expect(launched.ok).toBe(true)
    if (!attached.ok || !launched.ok) throw new Error('capture failed')
    expect(launched.data.openai).toEqual(attached.data.openai)
    expect(launched.data.anthropic).toEqual(attached.data.anthropic)
    expect(launched.data.neuralwatt).toEqual(attached.data.neuralwatt)
  })

  it('reports needsLogin when the neuralwatt billing page is a login page', async () => {
    await using harness = await setup({
      fakeFetchWorld: () =>
        fakeFetchWorld({
          overrides: {
            [neuralwattBillingKey]: {
              status: 200,
              body: '<html><body>Sign in</body></html>',
            },
          },
        }),
      isInteractiveTerminal: () => false,
      waitForEnter: async () => {
        throw new Error('must not prompt on a non-interactive terminal')
      },
    })

    const result = await harness.ensureCapture({ now: new Date() })

    expect(result).toEqual({
      ok: false,
      failure: expect.objectContaining({ ok: false, needsLogin: true }),
    })
    if (result.ok) throw new Error('expected the capture to need login')
    await expect(
      readFile(
        join(result.failure.artifactsPath, 'probe-neuralwatt-billing.html'),
        'utf8'
      )
    ).resolves.toBe('<html><body>Sign in</body></html>')
  })
})
