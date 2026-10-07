import { configureDependencies } from 'foundation/testing/harness/configureDependencies'
import { configureHarnesses } from 'foundation/testing/harness/configureHarnesses'
import { withDeps } from 'foundation/testing/harness/withDeps'
import { openBrowserSession } from './browser'
import { setupLocalServer } from './localServer.harness'
import { setupSleep } from './sleep.harness'

export const setupBrowserSession = configureHarnesses(
  setupLocalServer,
  setupSleep,
  async (userDeps) => {
    const deps = configureDependencies(
      {
        inferTypesFrom: { defaultDeps: openBrowserSession.defaultDeps },
        userDeps,
      },
      {
        spawnBrowser: async () => ({
          port: userDeps.port,
          exited: Promise.resolve(),
          shutdown: () => userDeps.stopServer(),
        }),
      }
    )
    return {
      ...userDeps,
      ...deps,
      openBrowserSession: withDeps(openBrowserSession, deps),
    }
  }
)
