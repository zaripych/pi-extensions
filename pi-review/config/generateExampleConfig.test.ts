import { describe, expect, it } from 'vitest'
import { generateExampleConfig } from './generateExampleConfig'

describe('generateExampleConfig', () => {
  it('generates YAML with description comments before each field', () => {
    const yaml = generateExampleConfig()

    expect(yaml).toContain('# Model to use for review.')
    expect(yaml).toContain('# Tools available to the reviewer agent.')
    expect(yaml).toContain('# Thresholds for filtering review findings.')
    expect(yaml).toContain('tools:')
    expect(yaml).toContain('thresholds:')
  })

  it('comments out optional fields with no default', () => {
    const yaml = generateExampleConfig()

    expect(yaml).toMatch(/^# model:/m)
  })

  it('includes default values for fields that have them', () => {
    const yaml = generateExampleConfig()

    expect(yaml).toContain('- read')
    expect(yaml).toContain('systemPrompt: review-prompt.md')
    expect(yaml).toContain('minConfidence: 0')
    expect(yaml).toContain('maxPriority: 3')
  })
})
