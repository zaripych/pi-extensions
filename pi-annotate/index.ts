/**
 * @author jackice
 * @date 2026-05-15
 */

import { fileURLToPath } from 'node:url'
import { dirname, extname, resolve } from 'node:path'
import { readFile, stat } from 'node:fs/promises'
import { execFileSync, spawn } from 'node:child_process'
import { platform } from 'node:os'
import type {
  ExtensionAPI,
  ExtensionContext,
  ExtensionCommandContext,
} from '@earendil-works/pi-coding-agent'
import { startAnnotationServer, type Annotation } from './server.js'

interface GlimpseWindow {
  on(event: 'closed', handler: (ok: boolean) => void): void
  close(): void
}

type Decision = {
  action: 'feedback' | 'approve' | 'exit'
  feedback?: string
  annotations?: Annotation[]
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

function findGlimpseBin(): string | null {
  try {
    const bin = execFileSync('which', ['glimpseui'], {
      encoding: 'utf-8',
    }).trim()
    return bin || null
  } catch {
    return null
  }
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function openInGlimpse(bin: string, url: string, title: string): GlimpseWindow {
  const safeTitle = escapeHtml(title || 'Annotate')
  const shellHTML = `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><title>${safeTitle}</title></head>
<body style="margin:0; background:#1a1a2e;">
  <script>window.location.replace(${JSON.stringify(url)});</script>
</body>
</html>`

  const child = spawn(
    bin,
    ['--width', '900', '--height', '750', '--title', title || 'Annotate'],
    {
      stdio: ['pipe', 'ignore', 'ignore'],
    }
  )

  let onClosed: ((ok: boolean) => void) | null = null
  let settled = false
  const settle = (ok: boolean) => {
    if (!settled) {
      settled = true
      onClosed?.(ok)
    }
  }
  child.once('exit', (code) => settle(code === 0))
  child.on('error', () => settle(false))
  child.stdin.on('error', () => {})
  child.stdin.end(shellHTML)

  return {
    on: (event, handler) => {
      if (event === 'closed') onClosed = handler
    },
    close: () => child.kill(),
  }
}

/**
 * Waits for the annotation outcome. A Glimpse window that fails to start
 * (spawn error, non-zero exit) resolves to "failed" instead of resolving an
 * exit decision, so the caller can fall back to the browser.
 */
function waitForGlimpseDecision(
  server: {
    waitForDecision: () => Promise<Decision>
    resolveDecision: (decision: Decision) => void
  },
  glimpseWin: GlimpseWindow
): Promise<Decision | 'failed'> {
  const failure = new Promise<'failed'>((done) => {
    glimpseWin.on('closed', (ok) => {
      if (ok) {
        server.resolveDecision({ action: 'exit' })
      } else {
        done('failed')
      }
    })
  })
  return Promise.race([server.waitForDecision(), failure])
}

async function openUrl(pi: ExtensionAPI, url: string): Promise<void> {
  let result: { code: number; stderr?: string }
  if (platform() === 'darwin') {
    result = await pi.exec('open', [url])
  } else if (platform() === 'win32') {
    result = await pi.exec('cmd', ['/c', 'start', '', url])
  } else {
    result = await pi.exec('xdg-open', [url])
  }
  if (result.code !== 0) {
    throw new Error(
      result.stderr || `Failed to open browser (exit code ${result.code})`
    )
  }
}

function getLastAssistantMessageText(ctx: ExtensionContext): string | null {
  const entries = ctx.sessionManager.getBranch()
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i]
    if (!entry) continue
    if (entry.type === 'message' && 'message' in entry) {
      const msg = entry.message
      if (msg.role === 'assistant') {
        const parts = msg.content.filter((c) => c.type === 'text')
        const text = parts
          .map((c) => c.text)
          .join('')
          .trim()
        if (text) return text
      }
    }
  }
  return null
}

const MARKDOWN_EXTENSIONS = /^(md|markdown|mdx)$/i

export function formatAnnotationFeedback(
  annotations: Annotation[],
  title: string,
  extension?: string
): string {
  if (!annotations || annotations.length === 0) return ''
  const items = annotations
    .map((a) => {
      const item: string[] = ['- Comment']
      const quoteLines = a.originalText
        ? a.originalText.replace(/\n+$/, '').split('\n')
        : []
      if (quoteLines.length > 0) {
        if (a.line !== undefined) {
          const line = a.line
          const longestRun = Math.max(
            2,
            ...(a.originalText.match(/`{3,}/g)?.map((run) => run.length) ?? [])
          )
          const fence = '`'.repeat(Math.max(3, longestRun + 1))
          const snippet = quoteLines
            .slice(0, 10)
            .map((text, i) => `  > ${line + i} ${text}`)
          if (quoteLines.length > 10) snippet.push(`  > ${line + 10} …`)
          item.push('', `  > ${fence}${extension}`, ...snippet, `  > ${fence}`)
        } else {
          item.push('', ...quoteLines.map((line) => `  > ${line}`))
        }
      }
      if (a.text)
        item.push('', ...a.text.split('\n').map((line) => `  ${line}`))
      return item.join('\n')
    })
    .join('\n\n')

  return `## Annotation Feedback\n\nThe following feedback was provided for ${title}:\n\n${items}\n\nPlease address the feedback above.`
}

const __dirname = dirname(fileURLToPath(import.meta.url))

async function readAnnotateHtml(): Promise<string> {
  const htmlPath = resolve(__dirname, 'form', 'annotate.html')
  return readFile(htmlPath, 'utf-8')
}

async function openAnnotationServer(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  options: {
    content: string
    mode: 'annotate' | 'annotate-last'
    title: string
    textFile?: { extension: string }
  }
): Promise<void> {
  const htmlContent = await readAnnotateHtml()

  const server = await startAnnotationServer({
    content: options.content,
    htmlContent,
    mode: options.mode,
    title: options.title,
    textFile: options.textFile,
  })

  if (platform() === 'darwin') {
    const glimpseBin = findGlimpseBin()
    if (glimpseBin) {
      try {
        const glimpseWin = openInGlimpse(
          glimpseBin,
          server.url,
          `Annotate: ${options.title}`
        )
        ctx.ui.notify('Annotation window opened. Close it when done.', 'info')

        const outcome = await waitForGlimpseDecision(server, glimpseWin)
        if (outcome === 'failed') {
          throw new Error('Glimpse window failed to launch')
        }
        if (outcome.action !== 'exit') {
          handleAnnotationDecision(
            pi,
            ctx,
            outcome,
            options.title,
            options.textFile?.extension
          )
        }
        server.stop()
        return
      } catch (err) {
        ctx.ui.notify(
          `Glimpse failed, falling back to browser: ${err instanceof Error ? err.message : String(err)}`,
          'warning'
        )
      }
    }
  }

  try {
    await openUrl(pi, server.url)
    const decision = await server.waitForDecision()
    handleAnnotationDecision(
      pi,
      ctx,
      decision,
      options.title,
      options.textFile?.extension
    )
    server.stop()
  } catch (err) {
    ctx.ui.notify(
      `Failed to open annotation: ${err instanceof Error ? err.message : String(err)}`,
      'error'
    )
  }
}

function handleAnnotationDecision(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  decision: Decision,
  title: string,
  extension?: string
): void {
  switch (decision.action) {
    case 'feedback': {
      let feedbackText = decision.feedback
      if (
        !feedbackText &&
        decision.annotations &&
        decision.annotations.length > 0
      ) {
        feedbackText = formatAnnotationFeedback(
          decision.annotations,
          title,
          extension
        )
      }
      if (!feedbackText) {
        feedbackText = `## Annotation Feedback\n\nThe following feedback was provided for ${title}. Please revise according to the suggestions above.`
      }
      pi.sendUserMessage(feedbackText, { deliverAs: 'followUp' })
      break
    }
    case 'approve':
      ctx.ui.notify(`${title} approved`, 'info')
      break
    case 'exit':
      break
  }
}

export default function (pi: ExtensionAPI) {
  pi.registerCommand('annotate-last', {
    description: 'Annotate the last assistant message in the current session',
    handler: async (_args: string, ctx: ExtensionCommandContext) => {
      const text = getLastAssistantMessageText(ctx)
      if (!text) {
        ctx.ui.notify('No assistant message found', 'error')
        return
      }

      ctx.ui.notify('Opening annotation for the last message...', 'info')

      return openAnnotationServer(pi, ctx, {
        content: text,
        mode: 'annotate-last',
        title: 'the last message',
      })
    },
  })

  pi.registerCommand('annotate', {
    description: 'Annotate a markdown document',
    handler: async (args: string, ctx: ExtensionCommandContext) => {
      try {
        const filePath = args.trim().replace(/^@/, '')

        if (!filePath) {
          ctx.ui.notify('Usage: /annotate <file>', 'error')
          return
        }

        const absolutePath = resolve(ctx.cwd, filePath)

        if (!(await fileExists(absolutePath))) {
          ctx.ui.notify(`File not found: ${absolutePath}`, 'error')
          return
        }

        ctx.ui.notify(`Opening annotation for ${filePath}...`, 'info')

        const raw = await readFile(absolutePath, 'utf-8')
        const ext = extname(absolutePath).slice(1)
        const isMarkdown = !ext || MARKDOWN_EXTENSIONS.test(ext)

        return openAnnotationServer(pi, ctx, {
          // Normalize CRLF for text files: the page computes line numbers and
          // offsets against this content, and line numbering is invariant
          // under CRLF → LF. Markdown keeps its original bytes.
          content: isMarkdown ? raw : raw.replace(/\r\n/g, '\n'),
          mode: 'annotate',
          title: filePath,
          textFile: isMarkdown ? undefined : { extension: ext },
        })
      } catch (err) {
        ctx.ui.notify(
          `Annotation failed: ${err instanceof Error ? err.message : String(err)}`,
          'error'
        )
      }
    },
  })

  pi.on('turn_end', async (event, ctx) => {
    if (event.message.role !== 'assistant') return

    const parts = event.message.content.filter((c) => c.type === 'text')
    const text = parts.map((c) => c.text).join('')
    if (!text) return

    const pattern = /docs\/superpowers\/(specs|plans)\/[^\s,.;:()!?]+\.md/g
    const matches = text.match(pattern)
    if (!matches || matches.length === 0) return

    let foundPath: string | null = null
    for (const match of matches) {
      const absolutePath = resolve(ctx.cwd, match)
      if (await fileExists(absolutePath)) {
        foundPath = absolutePath
        break
      }
    }

    if (!foundPath) return

    ctx.ui.notify('New document detected, opening annotation...', 'info')

    const content = await readFile(foundPath, 'utf-8')
    const htmlContent = await readAnnotateHtml()

    try {
      const server = await startAnnotationServer({
        content,
        htmlContent,
        mode: 'annotate',
        title: foundPath,
      })

      if (platform() === 'darwin') {
        const glimpseBin = findGlimpseBin()
        if (glimpseBin) {
          try {
            const glimpseWin = openInGlimpse(
              glimpseBin,
              server.url,
              `Annotate: ${foundPath}`
            )
            const outcome = await waitForGlimpseDecision(server, glimpseWin)
            if (outcome === 'failed') {
              throw new Error('Glimpse window failed to launch')
            }
            if (outcome.action !== 'exit') {
              handleAnnotationDecision(pi, ctx, outcome, foundPath)
            }
            server.stop()
            return
          } catch {}
        }
      }

      await openUrl(pi, server.url)
      const decision = await server.waitForDecision()
      handleAnnotationDecision(pi, ctx, decision, foundPath)
      server.stop()
    } catch (err) {
      console.error(
        `Auto-annotation failed: ${err instanceof Error ? err.message : String(err)}`
      )
    }
  })
}
