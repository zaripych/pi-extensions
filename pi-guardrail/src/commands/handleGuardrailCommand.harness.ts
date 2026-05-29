import { configureHarnesses } from 'foundation/testing/harness/configureHarnesses'
import { withDeps } from 'foundation/testing/harness/withDeps'
import { setupLoadPolicy } from '../config/loadPolicy.harness'
import { handleGuardrailCommand } from './handleGuardrailCommand'

export const setupHandleGuardrailCommand = configureHarnesses(
  {
    inferTypesFrom: { defaultDeps: handleGuardrailCommand.defaultDeps },
  },
  setupLoadPolicy,
  async (userDeps) => ({
    ...userDeps,
    handleGuardrailCommand: withDeps(handleGuardrailCommand, userDeps),
  })
)
