import { faker } from '@faker-js/faker'
import { configureDependencies } from 'foundation/testing/harness/configureDependencies'
import { configureHarnesses } from 'foundation/testing/harness/configureHarnesses'
import { withDeps } from 'foundation/testing/harness/withDeps'
import { normalizeAnthropicBilling } from './normalizeAnthropicBilling'

export const setupNormalizeAnthropicBilling = configureHarnesses(
  {
    inferTypesFrom: { defaultDeps: normalizeAnthropicBilling.defaultDeps },
  },
  async (userDeps) => {
    const deps = configureDependencies(
      {
        inferTypesFrom: { defaultDeps: normalizeAnthropicBilling.defaultDeps },
        userDeps,
      },
      {
        fetchOauthUsage: async () => ({
          seven_day: { utilization: faker.number.float({ min: 0, max: 100 }) },
        }),
      }
    )
    return {
      ...deps,
      normalizeAnthropicBilling: withDeps(normalizeAnthropicBilling, deps),
    }
  }
)
