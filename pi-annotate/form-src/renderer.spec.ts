import { describe, expect, it } from 'vitest'
import { renderMarkdown, renderTextFile } from './renderer.js'

describe('renderMarkdown', () => {
  it('renders headings, lists, and code', async () => {
    const html = await renderMarkdown(
      '# Title\n\n- a\n- b\n\n```ts\nconst x = 1;\n```\n'
    )
    expect(html).toContain('<h1 data-level="1"')
    expect(html).toContain('<li>a</li>')
    expect(html).toContain('class="shiki')
    expect(html).toContain('const')
  })

  it('wraps each top-level block with source offsets', async () => {
    const md = '# Title\n\nSome paragraph text.\n\n```js\nlet y = 2;\n```\n'
    const html = await renderMarkdown(md)
    const h1Start = md.indexOf('# Title')
    const pStart = md.indexOf('Some paragraph')
    const codeStart = md.indexOf('```js')
    expect(html).toContain(`data-offset-start="${h1Start}"`)
    expect(html).toContain(`data-offset-start="${pStart}"`)
    // Highlighted code blocks keep their source position (wrapper is applied
    // before @shikijs/rehype replaces the original <pre>)
    expect(html).toContain(`data-offset-start="${codeStart}"`)
  })

  it('renders gfm pipe tables as tables', async () => {
    const html = await renderMarkdown('| a | b |\n|---|---|\n| 1 | 2 |\n')
    expect(html).toContain('<table>')
    expect(html).toContain('<th>a</th>')
    expect(html).toContain('<td>1</td>')
  })

  it('opens links outside the annotation window', async () => {
    const html = await renderMarkdown('[docs](https://example.com)\n')
    expect(html).toContain('target="_blank"')
    expect(html).toContain('rel="noopener"')
  })

  it('emits both shiki theme color vars', async () => {
    const html = await renderMarkdown('```js\nlet y = 2;\n```\n')
    expect(html).toContain('--shiki-light')
    expect(html).toContain('--shiki-dark')
  })

  it('drops raw html instead of rendering it', async () => {
    const html = await renderMarkdown('<script>alert(1)</script>\n')
    expect(html).not.toContain('<script')
    expect(html).not.toContain('alert')
  })

  it('returns placeholder for empty input', async () => {
    expect(await renderMarkdown('')).toContain('(empty content)')
    expect(await renderMarkdown('   \n')).toContain('(empty content)')
  })
})

describe('renderTextFile', () => {
  const content = 'const x = 1;\nconst y = 2;\n'

  it('renders the whole file as one block with true file offsets', async () => {
    const html = await renderTextFile(content, 'ts')
    expect(html).toContain('data-offset-start="0"')
    expect(html).toContain(`data-offset-end="${content.length}"`)
    expect(html).toContain('md-block')
  })

  it('highlights with the extension and emits both theme vars', async () => {
    const html = await renderTextFile(content, 'ts')
    expect(html).toContain('shiki')
    expect(html).toContain('--shiki-light')
    expect(html).toContain('--shiki-dark')
  })

  it('falls back to plain for unknown extensions', async () => {
    const html = await renderTextFile('hello\n', 'weirdext')
    expect(html).toContain('hello')
    expect(html).not.toContain('<span style=') // plain: no token colors
  })

  it('returns placeholder for empty input', async () => {
    expect(await renderTextFile('', 'ts')).toContain('(empty content)')
  })
})
