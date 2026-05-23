import { describe, expect, it } from 'vitest'
import { defaultReviewConfig } from '../config/validateConfig'
import { renderTaskPrompt } from './renderTaskPrompt'

const { prompts } = defaultReviewConfig

describe('renderTaskPrompt', () => {
  it('renders uncommitted prompt as-is', () => {
    const result = renderTaskPrompt({
      target: { type: 'uncommitted' },
      prompts,
    })

    expect(result).toBe(prompts.uncommitted)
  })

  it('renders custom target with verbatim instructions', () => {
    const result = renderTaskPrompt({
      target: { type: 'custom', instructions: 'check error handling paths' },
      prompts,
    })

    expect(result).toBe('check error handling paths')
  })

  it('renders baseBranch prompt with variables replaced', () => {
    const result = renderTaskPrompt({
      target: {
        type: 'baseBranch',
        baseBranch: 'main',
        mergeBaseSha: 'abc1234',
      },
      prompts,
    })

    expect(result).toContain("'main'")
    expect(result).toContain('abc1234')
    expect(result).not.toContain('{{base_branch}}')
    expect(result).not.toContain('{{merge_base_sha}}')
  })

  it('renders baseBranchFallback prompt with variables replaced', () => {
    const result = renderTaskPrompt({
      target: {
        type: 'baseBranchFallback',
        branch: 'feature/login',
        upstreamBranch: 'origin/feature/login',
        mergeBaseSha: 'def5678',
      },
      prompts,
    })

    expect(result).toContain("'feature/login'")
    expect(result).toContain('origin/feature/login')
    expect(result).toContain('def5678')
    expect(result).not.toContain('{{branch}}')
    expect(result).not.toContain('{{upstream_branch}}')
    expect(result).not.toContain('{{merge_base_sha}}')
  })

  it('renders commit prompt with sha and title replaced', () => {
    const result = renderTaskPrompt({
      target: {
        type: 'commit',
        sha: 'abc1234',
        title: 'fix: handle empty input',
      },
      prompts,
    })

    expect(result).toContain('abc1234')
    expect(result).toContain('fix: handle empty input')
    expect(result).not.toContain('{{sha}}')
    expect(result).not.toContain('{{title}}')
  })

  it('uses commitNoTitle prompt when title is absent', () => {
    const result = renderTaskPrompt({
      target: { type: 'commit', sha: 'def5678' },
      prompts,
    })

    expect(result).toContain('def5678')
    expect(result).not.toContain('{{sha}}')
    expect(result).not.toContain('{{title}}')
    expect(result).not.toContain('("')
  })
})
