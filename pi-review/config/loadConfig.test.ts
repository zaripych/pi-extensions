import { combineHarnesses } from 'foundation/testing/harness/combineHarnesses'
import { describe, expect, it } from 'vitest'
import { stringify as stringifyYaml } from 'yaml'
import { setupLoadConfig } from './loadConfig.harness'

const setup = combineHarnesses(setupLoadConfig)

describe('loadConfig', () => {
  it('returns defaults when config file does not exist', async () => {
    await using harness = await setup()

    const result = await harness.loadConfig()

    const expectedPromptContent = await harness.getSystemPromptContent()
    const expectedCorrectnessContent =
      await harness.getCorrectnessInstructionsContent()

    expect(result).toEqual({
      config: {
        tools: ['read', 'grep', 'find', 'ls'],
        reviewInstructionsGlob: '**/*.review.md',
        systemPromptContent: expectedPromptContent,
        correctnessInstructionsContent: expectedCorrectnessContent,
        thresholds: {
          minConfidence: 0.0,
        },
      },
      configError: undefined,
      warnings: [],
    })
  })

  it('does not write a config file when it does not exist', async () => {
    await using harness = await setup()

    await harness.loadConfig()

    await expect(harness.readFile(harness.configPath)).rejects.toThrow('ENOENT')
  })

  it('never creates a user review-prompt.md', async () => {
    await using harness = await setup()

    await harness.loadConfig()

    await expect(
      harness.readFile(harness.obsoleteSystemPromptPath)
    ).rejects.toThrow('ENOENT')
  })

  it('reads existing config', async () => {
    await using harness = await setup()
    await harness.writeFile(
      harness.configPath,
      stringifyYaml({
        model: 'anthropic/claude-sonnet-4-20250514',
        tools: ['read', 'grep'],
        thresholds: {
          minConfidence: 0.75,
        },
      })
    )

    const result = await harness.loadConfig()

    const expectedCorrectnessContent =
      await harness.getCorrectnessInstructionsContent()

    expect(result).toEqual({
      config: {
        model: 'anthropic/claude-sonnet-4-20250514',
        systemPromptContent: await harness.getSystemPromptContent(),
        correctnessInstructionsContent: expectedCorrectnessContent,
        tools: ['read', 'grep'],
        reviewInstructionsGlob: '**/*.review.md',
        thresholds: {
          minConfidence: 0.75,
        },
      },
      configError: undefined,
      warnings: [],
    })
  })

  it('returns defaults with error when config has YAML syntax errors', async () => {
    await using harness = await setup()
    await harness.writeFile(harness.configPath, ':\ninvalid: yaml: {{{')

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
        thresholds: {
          minConfidence: 0,
        },
      })
    )

    const result = await harness.loadConfig()

    expect(result.configError).toContain('model')
    expect(result.configError).toContain(harness.configPath)
    expect(result.config.tools).toEqual(['read', 'grep', 'find', 'ls'])
  })

  it('warns when the obsolete systemPrompt key is set in review.yaml', async () => {
    await using harness = await setup()
    await harness.writeFile(
      harness.configPath,
      stringifyYaml({
        systemPrompt: 'review-prompt.md',
        thresholds: { minConfidence: 0 },
      })
    )

    const result = await harness.loadConfig()

    expect(result.warnings).toEqual([expect.stringContaining('"systemPrompt"')])
    expect(result.config).not.toHaveProperty('systemPrompt')
  })

  it('warns when an obsolete review-prompt.md exists in the config dir', async () => {
    await using harness = await setup()
    await harness.writeFile(harness.obsoleteSystemPromptPath, 'legacy prompt')

    const result = await harness.loadConfig()

    expect(result.warnings).toEqual([
      expect.stringContaining(harness.obsoleteSystemPromptPath),
    ])
    expect(result.warnings[0]).toContain('*.review.md')
  })

  it('combines both deprecation warnings when both apply', async () => {
    await using harness = await setup()
    await harness.writeFile(
      harness.configPath,
      stringifyYaml({ systemPrompt: 'review-prompt.md' })
    )
    await harness.writeFile(harness.obsoleteSystemPromptPath, 'legacy prompt')

    const result = await harness.loadConfig()

    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0]).toContain('"systemPrompt"')
    expect(result.warnings[0]).toContain(harness.obsoleteSystemPromptPath)
  })
})
