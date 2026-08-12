import { configureHarnesses } from 'foundation/testing/harness/configureHarnesses'
import { withDeps } from 'foundation/testing/harness/withDeps'
import { setupPrepareReviewForm } from './prepareReviewForm.harness'
import { collectReviewParams } from './collectReviewParams'

export const setupCollectReviewParams = configureHarnesses(
  {
    inferTypesFrom: { defaultDeps: collectReviewParams.defaultDeps },
  },
  setupPrepareReviewForm,
  async (deps) => ({
    ...deps,
    collectReviewParams: withDeps(collectReviewParams, deps),
  })
)
