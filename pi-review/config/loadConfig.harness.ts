import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { configureDependencies } from 'foundation/testing/harness/configureDependencies'
import { configureHarnesses } from 'foundation/testing/harness/configureHarnesses'
import { withDeps } from 'foundation/testing/harness/withDeps'
import { loadConfig } from './loadConfig'

export const setupLoadConfig = configureHarnesses(
  {
    inferTypesFrom: { defaultDeps: loadConfig.defaultDeps },
  },
  async (userDeps) => {
    const tempDir = await mkdtemp(join(tmpdir(), 'pi-review-load-config-'))
    const configPath = join(tempDir, 'review.yaml')
    const obsoleteSystemPromptPath = join(tempDir, 'review-prompt.md')
    const deps = configureDependencies(
      { inferTypesFrom: { defaultDeps: loadConfig.defaultDeps }, userDeps },
      {
        getConfigPaths: () => ({
          configPath,
          obsoleteSystemPromptPath,
        }),
        getSystemPromptContent: loadConfig.defaultDeps.getSystemPromptContent,
        getCorrectnessInstructionsContent:
          loadConfig.defaultDeps.getCorrectnessInstructionsContent,
        readFile: loadConfig.defaultDeps.readFile,
        writeFile: loadConfig.defaultDeps.writeFile,
        mkdir: loadConfig.defaultDeps.mkdir,
        fileExists: loadConfig.defaultDeps.fileExists,
      }
    )

    return {
      ...deps,
      configPath,
      obsoleteSystemPromptPath,
      loadConfig: withDeps(loadConfig, deps),
      async [Symbol.asyncDispose]() {
        await rm(tempDir, { recursive: true, force: true })
      },
    }
  }
)
