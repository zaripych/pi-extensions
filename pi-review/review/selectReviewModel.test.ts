import { describe, expect, it } from 'vitest'
import { selectReviewModel } from './selectReviewModel'

describe('selectReviewModel', () => {
  it('picks first available model when no current model', () => {
    const result = selectReviewModel({
      modelConfig: undefined,
      currentModelId: undefined,
      availableModelIds: [
        'anthropic/claude-sonnet-4-20250514',
        'openai/gpt-4o',
      ],
    })

    expect(result).toBe('anthropic/claude-sonnet-4-20250514')
  })

  it('picks first different model when current model is in candidates', () => {
    const result = selectReviewModel({
      modelConfig: undefined,
      currentModelId: 'anthropic/claude-sonnet-4-20250514',
      availableModelIds: [
        'anthropic/claude-sonnet-4-20250514',
        'openai/gpt-4o',
        'google/gemini-2.5-pro',
      ],
    })

    expect(result).toBe('openai/gpt-4o')
  })

  it('uses chooseFrom candidates instead of availableModels', () => {
    const result = selectReviewModel({
      modelConfig: { chooseFrom: ['openai/gpt-4o', 'google/gemini-2.5-pro'] },
      currentModelId: undefined,
      availableModelIds: [
        'anthropic/claude-sonnet-4-20250514',
        'openai/gpt-4o',
        'google/gemini-2.5-pro',
      ],
    })

    expect(result).toBe('openai/gpt-4o')
  })

  it('chooseFrom picks first different model when current model is in candidates', () => {
    const result = selectReviewModel({
      modelConfig: { chooseFrom: ['openai/gpt-4o', 'google/gemini-2.5-pro'] },
      currentModelId: 'openai/gpt-4o',
      availableModelIds: [
        'anthropic/claude-sonnet-4-20250514',
        'openai/gpt-4o',
        'google/gemini-2.5-pro',
      ],
    })

    expect(result).toBe('google/gemini-2.5-pro')
  })

  it('falls back to first candidate when current model is only candidate', () => {
    const result = selectReviewModel({
      modelConfig: undefined,
      currentModelId: 'anthropic/claude-sonnet-4-20250514',
      availableModelIds: ['anthropic/claude-sonnet-4-20250514'],
    })

    expect(result).toBe('anthropic/claude-sonnet-4-20250514')
  })

  it('picks first different provider when exact model not in candidates', () => {
    const result = selectReviewModel({
      modelConfig: undefined,
      currentModelId: 'anthropic/claude-sonnet-4-20250514',
      availableModelIds: ['anthropic/claude-3.5-sonnet', 'openai/gpt-4o'],
    })

    expect(result).toBe('openai/gpt-4o')
  })

  it('throws when no candidates available', () => {
    expect(() =>
      selectReviewModel({
        modelConfig: undefined,
        currentModelId: undefined,
        availableModelIds: [],
      })
    ).toThrow('No models available')
  })
})
