import { configureDependencies } from 'foundation/testing/harness/configureDependencies'
import { configureHarnesses } from 'foundation/testing/harness/configureHarnesses'
import { withDeps } from 'foundation/testing/harness/withDeps'
import { ensureCapture } from './ensureCapture'
import { loadCapture } from './loadCapture'
import { setupCapture } from './capture.harness'

export const setupEnsureCapture = configureHarnesses(
  setupCapture,
  async (userDeps) => {
    const deps = configureDependencies(
      { inferTypesFrom: { defaultDeps: ensureCapture.defaultDeps }, userDeps },
      {
        loadCapture: async () => loadCapture({ dir: userDeps.captureDir }),
      }
    )
    return {
      ...userDeps,
      ...deps,
      ensureCapture: withDeps(ensureCapture, deps),
    }
  }
)
