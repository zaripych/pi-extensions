import { faker } from '@faker-js/faker'
import { configureDependencies } from 'foundation/testing/harness/configureDependencies'
import { configureHarnesses } from 'foundation/testing/harness/configureHarnesses'
import { setupTmpDir } from '../testing/setupTmpDir'
import {
  getMergeBase,
  getUpstreamBranch,
  gitDiff,
  gitDiffCached,
  gitLog,
  gitShow,
  gitStatusShort,
  listBranches,
  listCommits,
} from './commands'

const defaultDeps = {
  listBranches,
  listCommits,
  getMergeBase,
  getUpstreamBranch,
  gitStatusShort,
  gitDiff,
  gitDiffCached,
  gitShow,
  gitLog,
}

export const setupGitCommands = configureHarnesses(
  {
    inferTypesFrom: { defaultDeps },
  },
  setupTmpDir,
  async (userDeps) => {
    const deps = configureDependencies(
      { inferTypesFrom: { defaultDeps }, userDeps },
      {
        listBranches: async () => [],
        listCommits: async () => [],
        getMergeBase: async () => faker.git.commitSha({ length: 7 }),
        getUpstreamBranch: async () => `origin/${faker.git.branch()}`,
        gitStatusShort: async () => `M  ${faker.system.filePath()}`,
        gitDiff: async () => {
          const { filePath } = await userDeps.createTempFile({
            content: `diff --git a/file.ts b/file.ts\n--- a/file.ts\n+++ b/file.ts\n@@ -1 +1 @@\n-old\n+${faker.lorem.word()}\n`,
          })
          return filePath
        },
        gitDiffCached: async () => {
          const { filePath } = await userDeps.createTempFile({
            content: `diff --git a/file.ts b/file.ts\n--- a/file.ts\n+++ b/file.ts\n@@ -1 +1 @@\n-old\n+${faker.lorem.word()}\n`,
          })
          return filePath
        },
        gitShow: async () => {
          const { filePath } = await userDeps.createTempFile({
            content: `commit ${faker.git.commitSha()}\nAuthor: ${faker.person.fullName()}\n\n    ${faker.git.commitMessage()}\n\ndiff --git a/file.ts b/file.ts\n`,
          })
          return filePath
        },
        gitLog: async () =>
          `${faker.git.commitSha({ length: 7 })} ${faker.git.commitMessage()}\n${faker.git.commitSha({ length: 7 })} ${faker.git.commitMessage()}`,
      }
    )

    return deps
  }
)
