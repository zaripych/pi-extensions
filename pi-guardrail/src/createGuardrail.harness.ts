import { configureHarnesses } from 'foundation/testing/harness/configureHarnesses'
import { withDeps } from 'foundation/testing/harness/withDeps'
import { setupHandleGuardrailCommand } from './commands/handleGuardrailCommand.harness'
import { createGuardrail } from './createGuardrail'

export const setupCreateGuardrail = configureHarnesses(
  {
    inferTypesFrom: { defaultDeps: createGuardrail.defaultDeps },
  },
  setupHandleGuardrailCommand,
  async (userDeps) => ({
    ...userDeps,
    createGuardrail: withDeps(createGuardrail, userDeps),
  })
)
