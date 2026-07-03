import { describe, expect, it, vi } from 'vitest'
import { ReviewForm, type ReviewFormTheme } from './ReviewForm'

const identity = (text: string) => text
const plainTheme: ReviewFormTheme = {
  cursor: identity,
  label: identity,
  value: identity,
  hint: identity,
  selectList: {
    selectedPrefix: identity,
    selectedText: identity,
    description: identity,
    scrollInfo: identity,
    noMatch: identity,
  },
}

function reviewFormData() {
  return {
    defaultTarget: 'branch' as const,
    branches: [
      { name: 'main', author: 'Bob' },
      { name: 'origin/main', author: 'Bob' },
      { name: 'feature/login', author: 'Alice' },
    ],
    defaultBase: 'origin/main',
    defaultBranch: 'main',
    commits: [
      { sha: 'abc1234', title: 'fix: handle empty input' },
      { sha: 'def5678', title: 'feat: add login' },
    ],
    models: ['openai/gpt-4o', 'anthropic/claude-sonnet-4-20250514'],
    defaultModel: 'openai/gpt-4o',
  }
}

function renderText(form: ReviewForm): string {
  return form.render(80).join('\n')
}

describe('ReviewForm', () => {
  it('renders target, base, model, and start rows for branch defaults', () => {
    const form = new ReviewForm({
      form: reviewFormData(),
      done: vi.fn(),
      theme: plainTheme,
    })

    const text = renderText(form)

    expect(text).toContain('Target')
    expect(text).toContain('Branch changes')
    expect(text).toContain('Base')
    expect(text).toContain('origin/main')
    expect(text).toContain('Model')
    expect(text).toContain('openai/gpt-4o')
    expect(text).toContain('Start review')
  })

  it('right arrow on target cycles to commit and swaps base row for commit row', () => {
    const form = new ReviewForm({
      form: reviewFormData(),
      done: vi.fn(),
      theme: plainTheme,
    })

    form.handleInput('\x1b[C')

    const text = renderText(form)
    expect(text).toContain('Commit')
    expect(text).toContain('abc1234 fix: handle empty input')
    expect(text).not.toContain('Base')
  })

  it('down then right cycles the base branch', () => {
    const form = new ReviewForm({
      form: reviewFormData(),
      done: vi.fn(),
      theme: plainTheme,
    })

    form.handleInput('\x1b[B')
    form.handleInput('\x1b[C')

    expect(renderText(form)).toContain('feature/login — Alice')
  })

  it('enter on Start review submits target, base, and model', () => {
    const done = vi.fn()
    const form = new ReviewForm({
      form: reviewFormData(),
      done,
      theme: plainTheme,
    })

    form.handleInput('\x1b[B')
    form.handleInput('\x1b[B')
    form.handleInput('\x1b[B')
    form.handleInput('\x1b[B')
    form.handleInput('\r')

    expect(done).toHaveBeenCalledWith({
      target: { type: 'baseBranch', branch: 'origin/main' },
      modelId: 'openai/gpt-4o',
    })
  })

  it('enter on Fetch origin asks for a fetch and reload', () => {
    const done = vi.fn()
    const form = new ReviewForm({
      form: reviewFormData(),
      done,
      theme: plainTheme,
    })

    form.handleInput('\x1b[B')
    form.handleInput('\x1b[B')
    form.handleInput('\x1b[B')
    form.handleInput('\r')

    expect(done).toHaveBeenCalledWith('fetch')
  })

  it('escape cancels the form', () => {
    const done = vi.fn()
    const form = new ReviewForm({
      form: reviewFormData(),
      done,
      theme: plainTheme,
    })

    form.handleInput('\x1b')

    expect(done).toHaveBeenCalledWith(undefined)
  })

  it('ctrl+enter submits from any row', () => {
    const done = vi.fn()
    const form = new ReviewForm({
      form: reviewFormData(),
      done,
      theme: plainTheme,
    })

    form.handleInput('\x1b[13;5u')

    expect(done).toHaveBeenCalledWith({
      target: { type: 'baseBranch', branch: 'origin/main' },
      modelId: 'openai/gpt-4o',
    })
  })

  it('enter on base opens a branch selector and picking updates the value', () => {
    const form = new ReviewForm({
      form: reviewFormData(),
      done: vi.fn(),
      theme: plainTheme,
    })

    form.handleInput('\x1b[B')
    form.handleInput('\r')

    const selectorText = renderText(form)
    expect(selectorText).toContain('main')
    expect(selectorText).toContain('feature/login')
    expect(selectorText).not.toContain('Start review')

    form.handleInput('\x1b[B')
    form.handleInput('\r')

    const formText = renderText(form)
    expect(formText).toContain('Start review')
    expect(formText).toContain('feature/login — Alice')
  })

  it('shows no author for main and origin/main', () => {
    const form = new ReviewForm({
      form: reviewFormData(),
      done: vi.fn(),
      theme: plainTheme,
    })

    expect(renderText(form)).toContain('‹ origin/main ›')

    form.handleInput('\x1b[B')
    form.handleInput('\x1b[C')

    expect(renderText(form)).toContain('‹ feature/login — Alice ›')
  })

  it('hides the author for the detected default branch', () => {
    const form = new ReviewForm({
      form: {
        ...reviewFormData(),
        branches: [
          { name: 'origin/master', author: 'Bob' },
          { name: 'feature/login', author: 'Alice' },
        ],
        defaultBase: 'origin/master',
        defaultBranch: 'master',
      },
      done: vi.fn(),
      theme: plainTheme,
    })

    expect(renderText(form)).toContain('‹ origin/master ›')
  })

  it('marks the selected row with a cursor', () => {
    const form = new ReviewForm({
      form: reviewFormData(),
      done: vi.fn(),
      theme: plainTheme,
    })

    form.handleInput('\x1b[B')

    expect(form.render(80)).toEqual([
      expect.stringContaining('  Target'),
      expect.stringContaining('❯ Base'),
      expect.stringContaining('  Model'),
      expect.stringContaining('  Fetch origin'),
      expect.stringContaining('  Start review'),
    ])
  })
})
