import { configureHarnesses } from 'foundation/testing/harness/configureHarnesses'
import { withDeps } from 'foundation/testing/harness/withDeps'
import { setupGitCommands } from '../git/commands.harness'
import { prepareReviewForm } from './prepareReviewForm'

export const setupPrepareReviewForm = configureHarnesses(
  {
    inferTypesFrom: { defaultDeps: prepareReviewForm.defaultDeps },
  },
  setupGitCommands,
  async (deps) => ({
    ...deps,
    prepareReviewForm: withDeps(prepareReviewForm, deps),
  })
)
