import { configureHarnesses } from 'foundation/testing/harness/configureHarnesses'
import { withDeps } from 'foundation/testing/harness/withDeps'
import { CdpProtocol } from './cdpProtocol'
import { fetchInPage } from './fetchInPage'
import { setupLocalServer } from './localServer.harness'
import { setupSleep } from './sleep.harness'

export const setupFetchInPage = configureHarnesses(
  setupLocalServer,
  setupSleep,
  async (userDeps) => {
    const cdp = await CdpProtocol.connect(
      userDeps.webSocketDebuggerUrl('chatgpt')
    )
    return {
      ...userDeps,
      fetchInPage: withDeps(fetchInPage, userDeps),
      cdp,
      async [Symbol.asyncDispose]() {
        cdp.close()
      },
    }
  }
)
