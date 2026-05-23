import { configureDependencies } from 'foundation/testing/harness/configureDependencies'
import { configureHarnesses } from 'foundation/testing/harness/configureHarnesses'
import { withDeps } from 'foundation/testing/harness/withDeps'
import { setupGitCommands } from '../git/commands.harness'
import { resolveTarget } from './resolveTarget'

export const setupResolveTarget = configureHarnesses(
  {
    inferTypesFrom: { defaultDeps: resolveTarget.defaultDeps },
  },
  setupGitCommands,
  async (userDeps) => {
    const deps = await configureDependencies(
      {
        inferTypesFrom: { defaultDeps: resolveTarget.defaultDeps },
        userDeps,
      },
      {
        getMergeBaseForBranch: userDeps.getMergeBase,
        getMergeBaseForUpstream: userDeps.getMergeBase,
        getUpstreamBranch: userDeps.getUpstreamBranch,
      }
    )

    return {
      ...deps,
      resolveTarget: withDeps(resolveTarget, deps),
    }
  }
)
