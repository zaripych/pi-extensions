import { faker } from '@faker-js/faker'
import { configureDependencies } from 'foundation/testing/harness/configureDependencies'
import { configureHarnesses } from 'foundation/testing/harness/configureHarnesses'
import { withDeps } from 'foundation/testing/harness/withDeps'
import { normalizeOpenaiBilling } from './normalizeOpenaiBilling'

export const setupNormalizeOpenaiBilling = configureHarnesses(
  {
    inferTypesFrom: { defaultDeps: normalizeOpenaiBilling.defaultDeps },
  },
  async (userDeps) => {
    const deps = configureDependencies(
      {
        inferTypesFrom: { defaultDeps: normalizeOpenaiBilling.defaultDeps },
        userDeps,
      },
      {
        // echoes the requested window so the default works for any cycle
        fetchDailyUsageBreakdown: async (params) => ({
          data: [
            {
              date: params.startDate,
              models: [
                {
                  model: faker.string.alphanumeric(10),
                  credits: faker.number.float({ min: 0, max: 100 }),
                },
              ],
            },
          ],
        }),
        fetchCreditUsageEvents: async () => ({ data: [] }),
      }
    )
    return {
      ...deps,
      normalizeOpenaiBilling: withDeps(normalizeOpenaiBilling, deps),
    }
  }
)
