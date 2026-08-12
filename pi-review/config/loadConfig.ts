import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { parse as parseYaml } from 'yaml'
import {
  getCorrectnessInstructionsContent,
  getSystemPromptContent,
} from './defaults'
import { generateExampleConfig } from './generateExampleConfig'
import { getConfigPaths } from './getConfigPaths'
import {
  defaultReviewConfig,
  type ReviewConfig,
  validateConfig,
} from './validateConfig'

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

const defaultDeps = {
  getConfigPaths,
  getSystemPromptContent,
  getCorrectnessInstructionsContent,
  readFile: (path: string) => readFile(path, 'utf-8'),
  writeFile: (path: string, content: string) =>
    writeFile(path, content, 'utf-8'),
  mkdir: (path: string) => mkdir(path, { recursive: true }),
  fileExists,
}

export type LoadedConfig = ReviewConfig & {
  systemPromptContent: string
  correctnessInstructionsContent: string
}

export type LoadConfigResult = {
  config: LoadedConfig
  configError: string | undefined
  warnings: string[]
}

function buildObsoleteSystemPromptWarning(params: {
  hasSystemPromptKey: boolean
  hasObsoletePromptFile: boolean
  obsoletePromptPath: string
}): string | undefined {
  if (!params.hasSystemPromptKey && !params.hasObsoletePromptFile) {
    return undefined
  }
  const lines: string[] = []
  if (params.hasSystemPromptKey) {
    lines.push(
      `The "systemPrompt" setting in review.yaml is no longer supported and is ignored. The review system prompt is now bundled and immutable.`
    )
  }
  if (params.hasObsoletePromptFile) {
    lines.push(
      `The file ${params.obsoletePromptPath} is no longer used and is ignored.`
    )
  }
  lines.push(
    `Add a repository Instructions file with a *.review.md suffix to customize review rubrics.`
  )
  return lines.join('\n')
}

export async function loadConfig(
  deps = defaultDeps
): Promise<LoadConfigResult> {
  const paths = deps.getConfigPaths()

  let config: ReviewConfig
  let configError: string | undefined
  let hasSystemPromptKey = false

  if (await deps.fileExists(paths.configPath)) {
    const yamlContent = await deps.readFile(paths.configPath)
    try {
      const rawYaml = parseYaml(yamlContent)
      if (
        typeof rawYaml === 'object' &&
        rawYaml !== null &&
        'systemPrompt' in rawYaml
      ) {
        hasSystemPromptKey = true
      }
      config = validateConfig(rawYaml)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      configError = `${message}\n\nConfig path: ${paths.configPath}`
      config = defaultReviewConfig
    }
  } else {
    config = defaultReviewConfig
  }

  const hasObsoletePromptFile = await deps.fileExists(
    paths.obsoleteSystemPromptPath
  )
  const deprecationWarning = buildObsoleteSystemPromptWarning({
    hasSystemPromptKey,
    hasObsoletePromptFile,
    obsoletePromptPath: paths.obsoleteSystemPromptPath,
  })

  await deps.mkdir(dirname(paths.configPath))
  await deps.writeFile(
    paths.configPath.replace(/\.yaml$/, '.yaml.example'),
    generateExampleConfig()
  )

  const [systemPromptContent, correctnessInstructionsContent] =
    await Promise.all([
      deps.getSystemPromptContent(),
      deps.getCorrectnessInstructionsContent(),
    ])

  return {
    config: {
      ...config,
      systemPromptContent,
      correctnessInstructionsContent,
    },
    configError,
    warnings: deprecationWarning ? [deprecationWarning] : [],
  }
}

loadConfig.defaultDeps = defaultDeps
