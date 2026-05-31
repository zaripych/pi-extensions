import { configureHarnesses } from 'foundation/testing/harness/configureHarnesses'
import { withDeps } from 'foundation/testing/harness/withDeps'
import { setupLoadPolicy } from '../config/loadPolicy.harness'
import { setupDiscoverCliCommands } from '../discover/discoverCliCommands.harness'
import { handleGuardrailCommand } from './handleGuardrailCommand'

export const setupHandleGuardrailCommand = configureHarnesses(
  {
    inferTypesFrom: { defaultDeps: handleGuardrailCommand.defaultDeps },
  },
  setupLoadPolicy,
  setupDiscoverCliCommands,
  async (userDeps) => ({
    ...userDeps,
    handleGuardrailCommand: withDeps(handleGuardrailCommand, userDeps),
  })
)
