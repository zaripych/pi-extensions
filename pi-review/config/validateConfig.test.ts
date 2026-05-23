import { describe, expect, it } from 'vitest'
import { defaultPrompts } from './defaults'
import { defaultReviewConfig, validateConfig } from './validateConfig'

type MutableConfig = Record<string, unknown> & {
  thresholds: Record<string, unknown>
}

function parseDefault(): MutableConfig {
  return structuredClone(defaultReviewConfig)
}

describe('validateConfig', () => {
  it('applies all defaults when parsing empty object', () => {
    const config = validateConfig({})

    expect(config).toEqual({
      tools: ['read', 'grep', 'find', 'ls'],
      systemPrompt: 'review-prompt.md',
      prompts: defaultPrompts,
      thresholds: {
        minConfidence: 0.0,
        maxPriority: 3,
      },
    })
  })

  it('applies all defaults when parsing null', () => {
    const config = validateConfig(null)

    expect(config).toEqual({
      tools: ['read', 'grep', 'find', 'ls'],
      systemPrompt: 'review-prompt.md',
      prompts: defaultPrompts,
      thresholds: {
        minConfidence: 0.0,
        maxPriority: 3,
      },
    })
  })

  it('rejects reviewer-git in tools as a reserved internal tool name', () => {
    const raw = parseDefault()
    raw.tools = ['read', 'reviewer-git']

    expect(() => validateConfig(raw)).toThrow('reviewer-git')
  })

  it('rejects finish-review in tools as a reserved internal tool name', () => {
    const raw = parseDefault()
    raw.tools = ['read', 'finish-review']

    expect(() => validateConfig(raw)).toThrow('finish-review')
  })

  it('rejects invalid tool-name syntax', () => {
    const raw = parseDefault()
    raw.tools = ['read', 'invalid tool name!']

    expect(() => validateConfig(raw)).toThrow('tools')
  })

  it('rejects empty string tool names', () => {
    const raw = parseDefault()
    raw.tools = ['read', '']

    expect(() => validateConfig(raw)).toThrow('tools')
  })

  it('rejects non-numeric minConfidence', () => {
    const raw = parseDefault()
    raw.thresholds.minConfidence = 'high'

    expect(() => validateConfig(raw)).toThrow('minConfidence')
  })

  it('rejects minConfidence below 0', () => {
    const raw = parseDefault()
    raw.thresholds.minConfidence = -0.1

    expect(() => validateConfig(raw)).toThrow('minConfidence')
  })

  it('rejects minConfidence above 1', () => {
    const raw = parseDefault()
    raw.thresholds.minConfidence = 1.5

    expect(() => validateConfig(raw)).toThrow('minConfidence')
  })

  it('rejects non-integer maxPriority', () => {
    const raw = parseDefault()
    raw.thresholds.maxPriority = 2.5

    expect(() => validateConfig(raw)).toThrow('maxPriority')
  })

  it('rejects maxPriority below 0', () => {
    const raw = parseDefault()
    raw.thresholds.maxPriority = -1

    expect(() => validateConfig(raw)).toThrow('maxPriority')
  })

  it('rejects maxPriority above 3', () => {
    const raw = parseDefault()
    raw.thresholds.maxPriority = 4

    expect(() => validateConfig(raw)).toThrow('maxPriority')
  })

  it('accepts undefined model (missing from config)', () => {
    const raw = parseDefault()
    delete raw.model

    const config = validateConfig(raw)
    expect(config.model).toBeUndefined()
  })

  it('accepts a fixed model string', () => {
    const raw = parseDefault()
    raw.model = 'anthropic/claude-sonnet-4-20250514'

    const config = validateConfig(raw)
    expect(config.model).toBe('anthropic/claude-sonnet-4-20250514')
  })

  it('accepts chooseFrom model with two entries', () => {
    const raw = parseDefault()
    raw.model = {
      chooseFrom: ['anthropic/claude-sonnet-4-20250514', 'openai/gpt-4o'],
    }

    const config = validateConfig(raw)
    expect(config.model).toEqual({
      chooseFrom: ['anthropic/claude-sonnet-4-20250514', 'openai/gpt-4o'],
    })
  })

  it('rejects chooseFrom model with one entry', () => {
    const raw = parseDefault()
    raw.model = { chooseFrom: ['anthropic/claude-sonnet-4-20250514'] }

    expect(() => validateConfig(raw)).toThrow('model')
  })

  it('rejects chooseFrom model with empty array', () => {
    const raw = parseDefault()
    raw.model = { chooseFrom: [] }

    expect(() => validateConfig(raw)).toThrow('model')
  })

  it('rejects numeric model with descriptive error', () => {
    const raw = parseDefault()
    raw.model = 42

    expect(() => validateConfig(raw)).toThrow(
      'must be a model string (e.g. "provider/model-id") or { chooseFrom: ["model1", "model2", ...] }'
    )
  })

  it('merges custom prompt overrides with defaults', () => {
    const raw = parseDefault()
    raw.prompts = {
      uncommitted: 'Only review uncommitted changes.',
    }

    const config = validateConfig(raw)

    expect(config.prompts).toEqual({
      ...defaultPrompts,
      uncommitted: 'Only review uncommitted changes.',
    })
  })

  it('accepts custom tools beyond the defaults', () => {
    const raw = parseDefault()
    raw.tools = ['read', 'bash', 'my_custom_tool']

    const config = validateConfig(raw)
    expect(config.tools).toEqual(['read', 'bash', 'my_custom_tool'])
  })
})
