import { configureHarnesses } from 'foundation/testing/harness/configureHarnesses'
import { withDeps } from 'foundation/testing/harness/withDeps'
import { resolveAaScores } from './resolveAaScores'
import { setupLoadAaModels } from './loadAaModels.harness'

export const setupResolveAaScores = configureHarnesses(
  setupLoadAaModels,
  async (deps) => ({
    ...deps,
    resolveAaScores: withDeps(resolveAaScores, deps),
  })
)
