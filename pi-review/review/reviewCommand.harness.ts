import { configureDependencies } from 'foundation/testing/harness/configureDependencies'
import { configureHarnesses } from 'foundation/testing/harness/configureHarnesses'
import { withDeps } from 'foundation/testing/harness/withDeps'
import { setupLoadConfig } from '../config/loadConfig.harness'
import { setupPickTarget } from './pickTarget.harness'
import { setupResolveTarget } from './resolveTarget.harness'
import { reviewCommand } from './reviewCommand'

export const setupReviewCommand = configureHarnesses(
  {
    inferTypesFrom: { defaultDeps: reviewCommand.defaultDeps },
  },
  setupPickTarget,
  setupLoadConfig,
  setupResolveTarget,
  async (userDeps) => {
    const deps = configureDependencies(
      {
        inferTypesFrom: { defaultDeps: reviewCommand.defaultDeps },
        userDeps,
      },
      {
        runReviewSession: async () => ({
          output: {
            findings: [],
            overall_correctness: 'patch is correct' as const,
            overall_explanation: 'No issues found.',
            overall_confidence_score: 0.9,
          } as const,
          sessionError: undefined,
        }),
      }
    )

    return {
      ...deps,
      reviewCommand: withDeps(reviewCommand, deps),
    }
  }
)
