import { describe, expect, it } from 'vitest'
import { combineHarnesses } from 'foundation/testing/harness/combineHarnesses'
import { setupFetchInPage } from './fetchInPage.harness'

const setup = combineHarnesses(setupFetchInPage)

const routes = {
  '/api/x': { status: 200, body: '{"ok":true}' },
}

describe('fetchInPage', () => {
  it('returns the raw response for a fetch inside the page', async () => {
    await using harness = await setup({ fakeFetchWorld: () => ({ routes }) })

    const response = await harness.fetchInPage({
      cdp: harness.cdp,
      url: '/api/x',
    })

    expect(response).toEqual({ status: 200, body: '{"ok":true}' })
  })

  it('retries a fetch interrupted by a protocol error', async () => {
    await using harness = await setup({ fakeFetchWorld: () => ({ routes }) })

    harness.failNextEvaluate('protocol-error')
    const response = await harness.fetchInPage({
      cdp: harness.cdp,
      url: '/api/x',
    })

    expect(response).toEqual({ status: 200, body: '{"ok":true}' })
  })

  it('rejects a malformed in-page result without retrying', async () => {
    await using harness = await setup({ fakeFetchWorld: () => ({ routes }) })

    harness.failNextEvaluate('malformed-response')
    await expect(
      harness.fetchInPage({ cdp: harness.cdp, url: '/api/x' })
    ).rejects.toThrow('expected object')
  })

  it('gives up after three failed evaluates', async () => {
    await using harness = await setup({ fakeFetchWorld: () => ({ routes }) })

    harness.failNextEvaluate('protocol-error', 3)
    await expect(
      harness.fetchInPage({ cdp: harness.cdp, url: '/api/x' })
    ).rejects.toThrow('injected protocol error')
  })
})
