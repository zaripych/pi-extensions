/**
 * @author jackice
 * @date 2026-05-15
 */

import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http'
import { randomUUID } from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { z } from 'zod'

export interface Annotation {
  id: string
  type: 'comment' | 'suggestion' | 'issue' | 'praise'
  text: string
  originalText: string
  range: {
    startOffset: number
    endOffset: number
    textPreview: string
  }
  createdAt: number
  line?: number
  lineEnd?: number
}

interface AnnotationServerOptions {
  content: string
  htmlContent: string
  mode: 'annotate' | 'annotate-last'
  title?: string
  textFile?: { extension: string }
}

interface AnnotationServerHandle {
  url: string
  stop: () => void
  waitForDecision: () => Promise<{
    action: 'feedback' | 'approve' | 'exit'
    feedback?: string
    annotations?: Annotation[]
  }>
  resolveDecision: (result: {
    action: 'feedback' | 'approve' | 'exit'
    feedback?: string
    annotations?: Annotation[]
  }) => void
}

const annotationSchema = z.object({
  id: z.string(),
  type: z.enum(['comment', 'suggestion', 'issue', 'praise']),
  text: z.string(),
  originalText: z.string(),
  range: z.object({
    startOffset: z.number(),
    endOffset: z.number(),
    textPreview: z.string(),
  }),
  createdAt: z.number(),
  line: z.number().optional(),
  lineEnd: z.number().optional(),
})

const feedbackBodySchema = z.object({
  feedback: z.string().default(''),
  annotations: z.array(annotationSchema).default([]),
})

const MAX_BODY_SIZE = 5 * 1024 * 1024
const REQUEST_TIMEOUT_MS = 30000
const STALE_TIMEOUT_MS = 2 * 60 * 1000 // 2 minutes

class BodyTooLargeError extends Error {
  statusCode = 413
}

class RequestTimeoutError extends Error {
  statusCode = 408
}

function requestUrl(req: IncomingMessage): URL {
  return new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`)
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
  })
  res.end(JSON.stringify(payload))
}

function sendHtml(res: ServerResponse, html: string): void {
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
  })
  res.end(html)
}

function parseJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let body = ''
    let size = 0
    let timedOut = false

    const timer = setTimeout(() => {
      timedOut = true
      req.destroy()
      reject(new RequestTimeoutError('Request timeout'))
    }, REQUEST_TIMEOUT_MS)

    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY_SIZE) {
        clearTimeout(timer)
        req.destroy()
        reject(new BodyTooLargeError('Request body too large'))
        return
      }
      body += chunk.toString('utf-8')
    })

    req.on('end', () => {
      if (timedOut) return
      clearTimeout(timer)
      if (body.length === 0) {
        resolve({})
        return
      }
      try {
        resolve(JSON.parse(body))
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        reject(new Error(`Invalid JSON: ${message}`))
      }
    })

    req.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
  })
}

function safeInlineJSON(data: unknown): string {
  return JSON.stringify(data)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
}

export async function startAnnotationServer(
  options: AnnotationServerOptions
): Promise<AnnotationServerHandle> {
  const { content, htmlContent, mode, title, textFile } = options
  const sessionToken = randomUUID()
  const isAuthorized = (req: IncomingMessage): boolean =>
    req.headers['x-annotate-token'] === sessionToken

  let resolved = false
  let resolveDecision!: (result: {
    action: 'feedback' | 'approve' | 'exit'
    feedback?: string
    annotations?: Annotation[]
  }) => void
  const decisionPromise = new Promise<{
    action: 'feedback' | 'approve' | 'exit'
    feedback?: string
    annotations?: Annotation[]
  }>((resolve) => {
    resolveDecision = resolve
  })

  const resolveOnce = (result: {
    action: 'feedback' | 'approve' | 'exit'
    feedback?: string
    annotations?: Annotation[]
  }): void => {
    if (resolved) return
    resolved = true
    resolveDecision(result)
  }

  let lastActivity = Date.now()

  // Renderer bundle built once per session from form-src/ — never stale
  let bundlePromise: Promise<string> | undefined
  const getRendererBundle = (): Promise<string> => {
    bundlePromise ??= build({
      entryPoints: [
        join(dirname(fileURLToPath(import.meta.url)), 'form-src', 'entry.mjs'),
      ],
      bundle: true,
      minify: true,
      format: 'iife',
      write: false,
      logLevel: 'warning',
    }).then((result) => {
      const output = result.outputFiles[0]
      if (!output) throw new Error('esbuild produced no output')
      return output.text
    })
    return bundlePromise
  }

  const handleRequest = async (
    req: IncomingMessage,
    res: ServerResponse
  ): Promise<void> => {
    lastActivity = Date.now()
    try {
      const method = req.method ?? 'GET'
      const url = requestUrl(req)

      if (method === 'GET' && url.pathname === '/') {
        const inlineData = safeInlineJSON({
          sessionToken,
          mode,
          title: title ?? null,
          textFile: textFile ?? null,
        })
        const html = htmlContent.replace('__ANNOTATE_DATA__', inlineData)
        sendHtml(res, html)
        return
      }

      if (method === 'GET' && url.pathname === '/vendor/markdown-render.js') {
        const bundle = await getRendererBundle()
        res.writeHead(200, {
          'Content-Type': 'text/javascript; charset=utf-8',
          'Cache-Control': 'no-store',
        })
        res.end(bundle)
        return
      }

      if (method === 'GET' && url.pathname === '/api/health') {
        sendJson(res, 200, { ok: true })
        return
      }

      if (method === 'GET' && url.pathname === '/api/document') {
        sendJson(res, 200, {
          content,
          mode,
          title: title ?? null,
        })
        return
      }

      if (method === 'POST' && !isAuthorized(req)) {
        sendJson(res, 401, { ok: false, error: 'Unauthorized' })
        return
      }

      if (method === 'POST' && url.pathname === '/api/feedback') {
        let body: unknown
        try {
          body = await parseJsonBody(req)
        } catch (err) {
          if (err instanceof BodyTooLargeError) {
            sendJson(res, 413, { ok: false, error: 'Request body too large' })
            return
          }
          if (err instanceof RequestTimeoutError) {
            sendJson(res, 408, { ok: false, error: 'Request timeout' })
            return
          }
          const message = err instanceof Error ? err.message : String(err)
          sendJson(res, 400, { ok: false, error: message })
          return
        }

        const parsed = feedbackBodySchema.safeParse(body)
        if (!parsed.success) {
          sendJson(res, 400, { ok: false, error: 'Invalid feedback payload' })
          return
        }

        resolveOnce({
          action: 'feedback',
          feedback: parsed.data.feedback,
          annotations: parsed.data.annotations,
        })

        sendJson(res, 200, { ok: true })
        return
      }

      if (method === 'POST' && url.pathname === '/api/approve') {
        try {
          await parseJsonBody(req)
        } catch {
          // Ignore parse errors — body is optional
        }

        resolveOnce({ action: 'approve' })
        sendJson(res, 200, { ok: true })
        return
      }

      if (method === 'POST' && url.pathname === '/api/exit') {
        try {
          await parseJsonBody(req)
        } catch {
          // Ignore parse errors — body is optional
        }

        resolveOnce({ action: 'exit' })
        sendJson(res, 200, { ok: true })
        return
      }

      sendJson(res, 404, { ok: false, error: 'Not found' })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      sendJson(res, 500, { ok: false, error: message })
    }
  }

  const server = createServer((req, res) => {
    void handleRequest(req, res)
  })

  const port = await new Promise<number>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (address && typeof address === 'object') {
        resolve(address.port)
      } else {
        reject(new Error('Failed to get server address'))
      }
    })
  })

  const url = `http://127.0.0.1:${port}`

  const staleTimer = setInterval(() => {
    if (resolved) {
      clearInterval(staleTimer)
      return
    }
    if (Date.now() - lastActivity > STALE_TIMEOUT_MS) {
      resolveOnce({ action: 'exit' })
      clearInterval(staleTimer)
    }
  }, 30000)

  const handle: AnnotationServerHandle = {
    url,
    stop: () => {
      clearInterval(staleTimer)
      server.close()
    },
    waitForDecision: () => decisionPromise,
    resolveDecision: resolveOnce,
  }

  return handle
}
