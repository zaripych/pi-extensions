import { configureHarnesses } from 'foundation/testing/harness/configureHarnesses'
import { withDeps } from 'foundation/testing/harness/withDeps'
import { setupCreateGuardrail } from './createGuardrail.harness'
import { registerGuardrail } from './register'

export const setupRegisterGuardrail = configureHarnesses(
  {
    inferTypesFrom: { defaultDeps: registerGuardrail.defaultDeps },
  },
  setupCreateGuardrail,
  async (userDeps) => ({
    ...userDeps,
    registerGuardrail: withDeps(registerGuardrail, userDeps),
  })
)
