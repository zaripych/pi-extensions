import { configureHarnesses } from '../configureHarnesses'
import { withDeps } from '../withDeps'
import { setupDbClient } from './createDbClient.harness'
import { getUserById, listUsers } from './userRepository'

export const setupUserRepository = configureHarnesses(
  {
    inferTypesFrom: {
      defaultDeps: getUserById.defaultDeps,
    },
  },
  setupDbClient,
  (deps) => ({
    ...deps,
    getUserById: withDeps(getUserById, deps),
    listUsers: withDeps(listUsers, deps),
  })
)
