import { describe, expect, it } from 'vitest'
import { formatAnnotationFeedback } from './index.js'
import type { Annotation } from './server.js'

describe('formatAnnotationFeedback', () => {
  const annotation = (overrides: Partial<Annotation> = {}): Annotation => ({
    id: 'a1',
    type: 'comment',
    text: 'fix this',
    originalText: 'const y = 2;',
    range: { startOffset: 20, endOffset: 32, textPreview: 'const y = 2;' },
    createdAt: 0,
    ...overrides,
  })

  it('renders text-file comments as a fenced snippet with line gutter', () => {
    const feedback = formatAnnotationFeedback(
      [annotation({ line: 2 })],
      'app.ts',
      'ts'
    )
    expect(feedback).toContain(
      '- Comment\n\n  > ```ts\n  > 2 const y = 2;\n  > ```\n\n  fix this'
    )
  })

  it('renders multi-line snippets using lineEnd', () => {
    const a = annotation({
      line: 2,
      lineEnd: 3,
      originalText: 'const y = 2;\nconst z = 3;',
      text: 'how about this',
    })
    const feedback = formatAnnotationFeedback([a], 'app.ts', 'ts')
    expect(feedback).toContain(
      '  > ```ts\n  > 2 const y = 2;\n  > 3 const z = 3;\n  > ```\n\n  how about this'
    )
  })

  it('caps text-file snippets at 10 lines with an ellipsis', () => {
    const lines = Array.from({ length: 20 }, (_, i) => `line${i + 1};`)
    const a = annotation({ line: 1, originalText: lines.join('\n') })
    const feedback = formatAnnotationFeedback([a], 'app.ts', 'ts')
    expect(feedback).toContain('  > 10 line10;')
    expect(feedback).toContain('  > 11 …')
    expect(feedback).not.toContain('line11;')
  })

  it('escapes fence-escalating content inside snippets', () => {
    const a = annotation({
      line: 1,
      originalText: 'text\n```js\nlet x = 1;\n```',
    })
    const feedback = formatAnnotationFeedback([a], 'app.ts', 'ts')
    expect(feedback).toContain(
      '  > ````ts\n  > 1 text\n  > 2 ```js\n  > 3 let x = 1;\n  > 4 ```\n  > ````'
    )
  })

  it('renders prose comments as a plain quote without line numbers', () => {
    const a = annotation({ originalText: 'Communication uses a RESTful API' })
    const feedback = formatAnnotationFeedback([a], 'plan.md')
    expect(feedback).toContain(
      '- Comment\n\n  > Communication uses a RESTful API\n\n  fix this'
    )
    expect(feedback).not.toContain('```')
    expect(feedback).not.toContain('Original text')
  })

  it('omits the message paragraph when the annotation has no text', () => {
    const feedback = formatAnnotationFeedback(
      [annotation({ text: '', line: 2 })],
      'app.ts',
      'ts'
    )
    expect(feedback).toContain(
      '- Comment\n\n  > ```ts\n  > 2 const y = 2;\n  > ```\n\nPlease address'
    )
  })
})
