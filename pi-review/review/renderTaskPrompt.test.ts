import { describe, expect, it } from 'vitest'
import { renderTaskPrompt } from './renderTaskPrompt'

describe('renderTaskPrompt', () => {
  it('renders uncommitted prompt', () => {
    const result = renderTaskPrompt({ type: 'uncommitted' })

    expect(result).toContain('statusShort')
    expect(result).toContain('diffCached')
  })

  it('renders custom target with verbatim instructions', () => {
    const result = renderTaskPrompt({
      type: 'custom',
      instructions: 'check error handling paths',
    })

    expect(result).toBe('check error handling paths')
  })

  it('renders baseBranch prompt with branch and merge base', () => {
    const result = renderTaskPrompt({
      type: 'baseBranch',
      baseBranch: 'main',
      mergeBaseSha: 'abc1234',
    })

    expect(result).toContain("the base branch 'main'")
    expect(result).toContain('abc1234')
    expect(result).not.toContain('upstream')
  })

  it('renders baseBranch prompt via upstream when upstreamBranch is set', () => {
    const result = renderTaskPrompt({
      type: 'baseBranch',
      baseBranch: 'feature/login',
      upstreamBranch: 'origin/feature/login',
      mergeBaseSha: 'def5678',
    })

    expect(result).toContain(
      "'feature/login' via its upstream 'origin/feature/login'"
    )
    expect(result).toContain('def5678')
    expect(result).toContain('relative to origin/feature/login')
  })

  it('renders commit prompt with sha and title', () => {
    const result = renderTaskPrompt({
      type: 'commit',
      sha: 'abc1234',
      title: 'fix: handle empty input',
    })

    expect(result).toContain('commit abc1234 ("fix: handle empty input")')
  })

  it('omits title when absent', () => {
    const result = renderTaskPrompt({ type: 'commit', sha: 'def5678' })

    expect(result).toContain('commit def5678')
    expect(result).not.toContain('("')
  })
})
