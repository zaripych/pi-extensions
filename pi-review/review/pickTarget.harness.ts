import { configureHarnesses } from 'foundation/testing/harness/configureHarnesses'
import { withDeps } from 'foundation/testing/harness/withDeps'
import { setupPrepareReviewForm } from './prepareReviewForm.harness'
import { pickTarget } from './pickTarget'

export const setupPickTarget = configureHarnesses(
  {
    inferTypesFrom: { defaultDeps: pickTarget.defaultDeps },
  },
  setupPrepareReviewForm,
  async (deps) => ({
    ...deps,
    pickTarget: withDeps(pickTarget, deps),
  })
)
