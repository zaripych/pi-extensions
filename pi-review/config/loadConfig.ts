import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { getDefaultSystemPromptContent } from './defaults'
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
  getDefaultSystemPromptContent,
  readFile: (path: string) => readFile(path, 'utf-8'),
  writeFile: (path: string, content: string) =>
    writeFile(path, content, 'utf-8'),
  mkdir: (path: string) => mkdir(path, { recursive: true }),
  fileExists,
}

export type LoadedConfig = ReviewConfig & { systemPromptContent: string }

export type LoadConfigResult = {
  config: LoadedConfig
  configError: string | undefined
}

export async function loadConfig(
  deps = defaultDeps
): Promise<LoadConfigResult> {
  const paths = deps.getConfigPaths()

  if (!(await deps.fileExists(paths.systemPromptPath))) {
    await deps.mkdir(dirname(paths.systemPromptPath))
    await deps.writeFile(
      paths.systemPromptPath,
      await deps.getDefaultSystemPromptContent()
    )
  }

  let config: ReviewConfig
  let configError: string | undefined

  if (await deps.fileExists(paths.configPath)) {
    const yamlContent = await deps.readFile(paths.configPath)
    try {
      const raw = parseYaml(yamlContent)
      config = validateConfig(raw)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      configError = `${message}\n\nConfig path: ${paths.configPath}`
      config = defaultReviewConfig
    }
  } else {
    config = defaultReviewConfig
  }

  const systemPromptContent = await deps.readFile(
    resolve(dirname(paths.configPath), config.systemPrompt)
  )

  await deps.mkdir(dirname(paths.configPath))
  await deps.writeFile(
    resolve(dirname(paths.configPath), 'review.yaml.example'),
    generateExampleConfig()
  )

  return { config: { ...config, systemPromptContent }, configError }
}

loadConfig.defaultDeps = defaultDeps
