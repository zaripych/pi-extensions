import { configureDependencies } from 'foundation/testing/harness/configureDependencies'
import { configureHarnesses } from 'foundation/testing/harness/configureHarnesses'
import { withDeps } from 'foundation/testing/harness/withDeps'
import { discoverCliCommands } from './discoverCliCommands'

export const setupDiscoverCliCommands = configureHarnesses(
  {
    inferTypesFrom: { defaultDeps: discoverCliCommands.defaultDeps },
  },
  async (userDeps) => {
    const deps = configureDependencies(
      {
        inferTypesFrom: { defaultDeps: discoverCliCommands.defaultDeps },
        userDeps,
      },
      {
        runCliHelp: discoverCliCommands.defaultDeps.runCliHelp,
      }
    )

    return {
      ...deps,
      discoverCliCommands: withDeps(discoverCliCommands, deps),
    }
  }
)
