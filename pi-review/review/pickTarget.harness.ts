import { configureHarnesses } from 'foundation/testing/harness/configureHarnesses'
import { withDeps } from 'foundation/testing/harness/withDeps'
import { setupGitCommands } from '../git/commands.harness'
import { pickTarget } from './pickTarget'

export const setupPickTarget = configureHarnesses(
  {
    inferTypesFrom: { defaultDeps: pickTarget.defaultDeps },
  },
  setupGitCommands,
  async (deps) => ({
    ...deps,
    pickTarget: withDeps(pickTarget, deps),
  })
)
