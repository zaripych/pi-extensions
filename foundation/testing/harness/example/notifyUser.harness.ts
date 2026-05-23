import { configureHarnesses } from '../configureHarnesses'
import { withDeps } from '../withDeps'
import { setupCreateMailer } from './createMailer.harness'
import { notifyUser } from './notifyUser'
import { setupUserRepository } from './userRepository.harness'

export const setupNotifyUser = configureHarnesses(
  {
    inferTypesFrom: {
      defaultDeps: notifyUser.defaultDeps,
    },
  },
  setupUserRepository,
  setupCreateMailer,
  (deps) => ({
    ...deps,
    notifyUser: withDeps(notifyUser, deps),
  })
)
