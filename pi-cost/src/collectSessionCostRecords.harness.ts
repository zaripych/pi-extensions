import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { configureDependencies } from 'foundation/testing/harness/configureDependencies'
import { configureHarnesses } from 'foundation/testing/harness/configureHarnesses'
import { withDeps } from 'foundation/testing/harness/withDeps'
import { collectSessionCostRecords } from './collectSessionCostRecords'

export const setupCollectSessionCostRecords = configureHarnesses(
  {
    inferTypesFrom: { defaultDeps: collectSessionCostRecords.defaultDeps },
  },
  async (userDeps) => {
    const sessionsDir = await mkdtemp(
      join(tmpdir(), 'pi-cost-counter-sessions-')
    )
    const deps = configureDependencies(
      {
        inferTypesFrom: { defaultDeps: collectSessionCostRecords.defaultDeps },
        userDeps,
      },
      {
        getSessionsDir: () => sessionsDir,
      }
    )

    return {
      ...deps,
      sessionsDir,
      collectSessionCostRecords: withDeps(collectSessionCostRecords, deps),
      async [Symbol.asyncDispose]() {
        await rm(sessionsDir, { recursive: true, force: true })
      },
    }
  }
)
