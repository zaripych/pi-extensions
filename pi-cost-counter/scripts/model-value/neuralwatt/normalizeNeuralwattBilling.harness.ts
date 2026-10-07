import { configureDependencies } from 'foundation/testing/harness/configureDependencies'
import { configureHarnesses } from 'foundation/testing/harness/configureHarnesses'
import { withDeps } from 'foundation/testing/harness/withDeps'
import { normalizeNeuralwattBilling } from './normalizeNeuralwattBilling'

export const setupNormalizeNeuralwattBilling = configureHarnesses(
  {
    inferTypesFrom: { defaultDeps: normalizeNeuralwattBilling.defaultDeps },
  },
  async (userDeps) => {
    const deps = configureDependencies(
      {
        inferTypesFrom: { defaultDeps: normalizeNeuralwattBilling.defaultDeps },
        userDeps,
      },
      {
        fetchQuota: async () => ({
          subscription: {
            current_period_start: '2026-09-12T04:15:28Z',
            current_period_end: '2026-10-12T04:15:28Z',
            kwh_included: 6.25,
            kwh_used: 3.9549,
            in_overage: false,
          },
        }),
        fetchUsageByModel: async (params) => ({
          period: {
            start: `${params.startDate}T00:00:00Z`,
            end: `${params.endDate}T00:00:00Z`,
          },
          products: [],
        }),
        fetchUsageSummary: async (params) => ({
          period: {
            start: `${params.startDate}T00:00:00Z`,
            end: `${params.endDate}T00:00:00Z`,
          },
          totals: { total_cost_usd: 8, energy_kwh_charged: 1 },
        }),
      }
    )
    return {
      ...deps,
      normalizeNeuralwattBilling: withDeps(normalizeNeuralwattBilling, deps),
    }
  }
)
