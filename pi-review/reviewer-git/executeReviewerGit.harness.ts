import { configureHarnesses } from 'foundation/testing/harness/configureHarnesses'
import { withDeps } from 'foundation/testing/harness/withDeps'
import { setupGitCommands } from '../git/commands.harness'
import { executeReviewerGit } from './executeReviewerGit'

export const setupExecuteReviewerGit = configureHarnesses(
  {
    inferTypesFrom: { defaultDeps: executeReviewerGit.defaultDeps },
  },
  setupGitCommands,
  async (deps) => ({
    ...deps,
    executeReviewerGit: withDeps(executeReviewerGit, deps),
  })
)
