import { describe, expect, it } from 'vitest'
import { combineHarnesses } from 'foundation/testing/harness/combineHarnesses'
import { setupBrowserSession } from './browser.harness'

const setup = combineHarnesses(setupBrowserSession)

describe('openBrowserSession', () => {
  it('releases its connections when session initialization fails', async () => {
    await using harness = await setup()
    // waitForReady gives up after 30 evaluates, all answered with errors
    harness.failNextEvaluate('protocol-error', 30)

    await expect(
      harness.openBrowserSession({ port: harness.port })
    ).rejects.toThrow('page did not become ready')

    await expect.poll(() => harness.openConnections()).toBe(0)
  })
})
