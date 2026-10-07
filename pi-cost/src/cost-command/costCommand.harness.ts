import { faker } from '@faker-js/faker'
import { configureDependencies } from 'foundation/testing/harness/configureDependencies'
import { configureHarnesses } from 'foundation/testing/harness/configureHarnesses'
import { setupPiHarness } from 'shared/testing/pi.harness'
import type { UsageInputs } from '../model-value/loadUsageInputs'
import { registerCostCommand } from './registerCostCommand'

function fakeUsageInputs(): UsageInputs {
  return {
    providers: [
      {
        provider: faker.helpers.arrayElement([
          'openai',
          'anthropic',
          'neuralwatt',
        ]),
        cycleStart: '2026-09-01',
        cycleEnd: '2026-10-01',
        planPaymentAud: faker.number.float({ min: 10, max: 100 }),
        creditPurchasesAud: faker.number.float({ min: 0, max: 50 }),
        utilization: {
          basis: 'elapsed',
          fraction: faker.number.float({ min: 0, max: 1 }),
        },
        creditsConsumedAud: faker.number.float({ min: 0, max: 20 }),
        modelShares: null,
      },
    ],
    records: [
      {
        ts: faker.number.int({ min: 1_700_000_000, max: 1_800_000_000 }) * 1000,
        sessionId: faker.string.uuid(),
        cwd: faker.system.directoryPath(),
        provider: 'openai-codex',
        model: `model-${faker.string.alphanumeric(6)}`,
        tokens: {
          input: faker.number.int({ min: 1, max: 5_000_000 }),
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
        },
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
    ],
    aaScores: new Map(),
  }
}

export const setupCostCommand = configureHarnesses(
  {
    inferTypesFrom: {
      defaultDeps: registerCostCommand.defaultDeps,
      harnesses: [setupPiHarness],
    },
  },
  setupPiHarness,
  async (userDeps) => {
    const deps = configureDependencies(
      {
        inferTypesFrom: { defaultDeps: registerCostCommand.defaultDeps },
        userDeps,
      },
      {
        loadUsageInputs: async () => fakeUsageInputs(),
        // fixed mid-cycle clock so elapsed-fraction snapshots are stable
        now: () => new Date(2026, 8, 15),
      }
    )
    return {
      ...userDeps,
      ...deps,
      registerCostCommand: (pi: Parameters<typeof registerCostCommand>[0]) =>
        registerCostCommand(pi, deps),
    }
  }
)
