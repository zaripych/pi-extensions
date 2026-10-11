import { toHtml } from 'hast-util-to-html'
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import remarkRehype from 'remark-rehype'
import rehypeStringify from 'rehype-stringify'
import { createHighlighterCore } from 'shiki/core'
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript'
import rehypeShikiCore from '@shikijs/rehype/core'
import githubDark from 'shiki/themes/github-dark.mjs'
import githubLight from 'shiki/themes/github-light.mjs'
import langBash from 'shiki/langs/bash.mjs'
import langCss from 'shiki/langs/css.mjs'
import langHtml from 'shiki/langs/html.mjs'
import langJavascript from 'shiki/langs/javascript.mjs'
import langJson from 'shiki/langs/json.mjs'
import langMarkdown from 'shiki/langs/markdown.mjs'
import langPython from 'shiki/langs/python.mjs'
import langShellscript from 'shiki/langs/shellscript.mjs'
import langTypescript from 'shiki/langs/typescript.mjs'
import langYaml from 'shiki/langs/yaml.mjs'
import { visit } from 'unist-util-visit'
import type { HighlighterCore } from 'shiki'
import type { Root as MdastRoot, Heading } from 'mdast'
import type { Element, ElementContent, Root as HastRoot } from 'hast'

function remarkHeadingDepth() {
  return (tree: MdastRoot) => {
    visit(tree, 'heading', (node: Heading) => {
      node.data ??= {}
      node.data.hProperties = {
        ...node.data.hProperties,
        dataLevel: node.depth,
      }
    })
  }
}

/**
 * Wraps each top-level block in a .md-block div carrying data-offset-start /
 * data-offset-end — character offsets into the annotated document. The
 * annotation UI uses these to map text selections back to source ranges.
 */
function rehypeWrapBlocks(
  getRange: (node: ElementContent) => { start: number; end: number }
) {
  return (tree: HastRoot) => {
    const content = tree.children.filter(
      (node): node is ElementContent => node.type !== 'doctype'
    )
    tree.children = content.map((node) => {
      const { start, end } = getRange(node)
      const wrapper: Element = {
        type: 'element',
        tagName: 'div',
        properties: {
          className: ['md-block'],
          dataOffsetStart: start,
          dataOffsetEnd: end,
        },
        children: [node],
      }
      return wrapper
    })
  }
}

function rehypeMdBlocks() {
  return rehypeWrapBlocks((node) => ({
    start: node.position?.start.offset ?? 0,
    end: node.position?.end.offset ?? 0,
  }))
}

const LANGS = [
  langBash,
  langCss,
  langHtml,
  langJavascript,
  langJson,
  langMarkdown,
  langPython,
  langShellscript,
  langTypescript,
  langYaml,
]

let highlighterPromise: Promise<HighlighterCore> | undefined

function getHighlighter(): Promise<HighlighterCore> {
  highlighterPromise ??= createHighlighterCore({
    themes: [githubDark, githubLight],
    langs: LANGS,
    engine: createJavaScriptRegexEngine(),
  })
  return highlighterPromise
}

/**
 * Opens links outside the annotation window — a click must not navigate away
 * and discard unsent annotations.
 */
function rehypeExternalLinks() {
  return (tree: HastRoot) => {
    visit(tree, 'element', (node) => {
      if (node.tagName === 'a') {
        node.properties.target = '_blank'
        node.properties.rel = ['noopener']
      }
    })
  }
}

export async function renderMarkdown(markdown: string): Promise<string> {
  if (!markdown || !markdown.trim()) {
    return '<p style="color:var(--text-muted)">(empty content)</p>'
  }

  const highlighter = await getHighlighter()
  const file = await unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkHeadingDepth)
    .use(remarkRehype)
    // Wrap blocks BEFORE highlighting: @shikijs/rehype replaces the original
    // <pre> with a generated fragment that carries no source position, so
    // wrapping afterwards would give every code block offsets 0–0.
    .use(rehypeMdBlocks)
    .use(rehypeExternalLinks)
    .use(rehypeShikiCore, highlighter, {
      themes: { light: 'github-light', dark: 'github-dark' },
      defaultColor: false,
      fallbackLanguage: 'plain',
    })
    .use(rehypeStringify)
    .process(markdown)
  return String(file)
}

/**
 * Renders a plain text file as a single fenced-style code block. Block offsets
 * span the whole content, so annotation coordinates are true file offsets.
 */
export async function renderTextFile(
  content: string,
  extension: string
): Promise<string> {
  if (!content || !content.trim()) {
    return '<p style="color:var(--text-muted)">(empty content)</p>'
  }

  const highlighter = await getHighlighter()
  const treeIn: HastRoot = {
    type: 'root',
    children: [
      {
        type: 'element',
        tagName: 'pre',
        properties: {},
        children: [
          {
            type: 'element',
            tagName: 'code',
            properties: { className: [`language-${extension}`] },
            children: [{ type: 'text', value: content }],
          },
        ],
      },
    ],
  }

  const tree = await unified()
    .use(rehypeShikiCore, highlighter, {
      themes: { light: 'github-light', dark: 'github-dark' },
      defaultColor: false,
      fallbackLanguage: 'plain',
    })
    .use(rehypeWrapBlocks, () => ({ start: 0, end: content.length }))
    .run(treeIn)
  return toHtml(tree)
}
