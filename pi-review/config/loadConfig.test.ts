import { combineHarnesses } from 'foundation/testing/harness/combineHarnesses'
import { describe, expect, it } from 'vitest'
import { stringify as stringifyYaml } from 'yaml'
import { setupLoadConfig } from './loadConfig.harness'

const setup = combineHarnesses(setupLoadConfig)

describe('loadConfig', () => {
  it('returns defaults when config file does not exist', async () => {
    await using harness = await setup()

    const result = await harness.loadConfig()

    const expectedPromptContent = await harness.getDefaultSystemPromptContent()

    expect(result).toEqual({
      config: {
        tools: ['read', 'grep', 'find', 'ls'],
        systemPrompt: 'review-prompt.md',
        systemPromptContent: expectedPromptContent,
        thresholds: {
          minConfidence: 0.0,
          maxPriority: 3,
        },
      },
      configError: undefined,
    })
  })

  it('does not write config file when it does not exist', async () => {
    await using harness = await setup()

    await harness.loadConfig()

    await expect(harness.readFile(harness.configPath)).rejects.toThrow('ENOENT')
  })

  it('creates system prompt file when missing', async () => {
    await using harness = await setup()

    await harness.loadConfig()

    expect(await harness.readFile(harness.systemPromptPath)).toBe(
      await harness.getDefaultSystemPromptContent()
    )
  })

  it('reads existing config', async () => {
    await using harness = await setup()
    await harness.writeFile(
      harness.configPath,
      stringifyYaml({
        model: 'anthropic/claude-sonnet-4-20250514',
        tools: ['read', 'grep'],
        systemPrompt: harness.systemPromptPath,
        thresholds: {
          minConfidence: 0.75,
          maxPriority: 2,
        },
      })
    )
    await harness.writeFile(harness.systemPromptPath, 'Existing system prompt')

    const result = await harness.loadConfig()

    expect(result).toEqual({
      config: {
        model: 'anthropic/claude-sonnet-4-20250514',
        systemPromptContent: 'Existing system prompt',
        tools: ['read', 'grep'],
        systemPrompt: harness.systemPromptPath,
        thresholds: {
          minConfidence: 0.75,
          maxPriority: 2,
        },
      },
      configError: undefined,
    })
  })

  it('returns defaults with error when config has YAML syntax errors', async () => {
    await using harness = await setup()
    await harness.writeFile(harness.configPath, ':\ninvalid: yaml: {{{')
    await harness.writeFile(harness.systemPromptPath, 'System prompt')

    const result = await harness.loadConfig()

    expect(result.configError).toContain(harness.configPath)
    expect(result.config.tools).toEqual(['read', 'grep', 'find', 'ls'])
  })

  it('returns defaults with error when config is invalid', async () => {
    await using harness = await setup()
    await harness.writeFile(
      harness.configPath,
      stringifyYaml({
        model: 42,
        tools: ['read'],
        systemPrompt: harness.systemPromptPath,
        thresholds: {
          minConfidence: 0,
          maxPriority: 3,
        },
      })
    )
    await harness.writeFile(harness.systemPromptPath, 'System prompt')

    const result = await harness.loadConfig()

    expect(result.configError).toContain('model')
    expect(result.configError).toContain(harness.configPath)
    expect(result.config.tools).toEqual(['read', 'grep', 'find', 'ls'])
  })
})
