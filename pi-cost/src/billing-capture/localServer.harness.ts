import { createServer, type ServerResponse } from 'node:http'
import { runInNewContext } from 'node:vm'
import { faker } from '@faker-js/faker'
import { WebSocketServer, type RawData, type WebSocket } from 'ws'
import { z } from 'zod'
import { fakeFetchWorld, type FetchWorld } from './fakeBillingData'

const CHATGPT_ORIGIN = 'https://chatgpt.com'
const CLAUDE_ORIGIN = 'https://claude.ai'
const NEURALWATT_ORIGIN = 'https://portal.neuralwatt.com'
const CHATGPT_SESSION_ROUTE = '/api/auth/session'
const CLAUDE_ORGANIZATIONS_ROUTE = '/api/organizations'

/** CDP-level failures a test can inject into the next Runtime.evaluate. */
export type CdpFailure =
  | 'protocol-error'
  | 'malformed-response'
  | 'disconnected'

type Provider = 'chatgpt' | 'claude' | 'neuralwatt'

type Target = {
  provider: Provider
  url: string
  id: string
  cookies: Array<{ name: string; value: string }>
}

const cdpMessage = z.object({
  id: z.number(),
  method: z.string(),
  params: z.record(z.string(), z.unknown()).optional(),
})

const evaluateParams = z.object({ expression: z.string() })

const sessionBody = z.object({
  accessToken: z.string().optional(),
  account: z.object({ id: z.string() }).optional(),
})

/** RawData (Buffer | ArrayBuffer | Buffer[]) reduced to text — every
 * message CdpProtocol sends is a single text frame, so Buffer is the
 * realistic path. */
function messageText(data: RawData): string {
  if (Buffer.isBuffer(data)) return data.toString()
  if (Array.isArray(data)) return Buffer.concat(data).toString()
  return Buffer.from(data).toString()
}

const harnessDeps = {
  fakeFetchWorld,
}

/** In-process stand-in for the browser's debug endpoint: serves the HTTP
 * discovery routes and a WebSocket CDP connection per target. The
 * Runtime.evaluate handler executes the generated expression in node:vm
 * with a fixture-backed fetch, so the fetchInPage → CdpProtocol chain runs
 * unchanged against local fixtures. */
export async function setupLocalServer(userDeps = harnessDeps) {
  const deps = { ...harnessDeps, ...userDeps }
  const world: FetchWorld = deps.fakeFetchWorld()
  const targets: Record<Provider, Target> = {
    chatgpt: {
      provider: 'chatgpt',
      url: CHATGPT_ORIGIN,
      id: faker.string.alphanumeric(16),
      cookies: [{ name: 'oai-did', value: faker.string.alphanumeric(16) }],
    },
    claude: {
      provider: 'claude',
      url: CLAUDE_ORIGIN,
      id: faker.string.alphanumeric(16),
      cookies: [{ name: 'sessionKey', value: faker.string.alphanumeric(16) }],
    },
    neuralwatt: {
      provider: 'neuralwatt',
      url: NEURALWATT_ORIGIN,
      id: faker.string.alphanumeric(16),
      cookies: [{ name: 'session', value: faker.string.alphanumeric(16) }],
    },
  }
  let nextEvaluateFailure:
    | { failure: CdpFailure; remaining: number }
    | undefined
  const targetList = () => Object.values(targets)

  const webSocketDebuggerUrl = (target: Target) =>
    `ws://127.0.0.1:${port}/devtools/page/${target.id}`

  function descriptor(target: Target) {
    return {
      id: target.id,
      title: target.url,
      type: 'page',
      url: target.url,
      webSocketDebuggerUrl: webSocketDebuggerUrl(target),
    }
  }

  /** A non-page target listed ahead of the chatgpt page — target selection
   * must skip it for the page. Its debug URL matches no target, so a
   * regression that connects to it fails loudly. */
  function serviceWorkerDescriptor() {
    return {
      id: 'chatgpt-service-worker',
      title: 'ChatGPT service worker',
      type: 'service_worker',
      url: `${CHATGPT_ORIGIN}/serviceworker.js`,
      webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/page/chatgpt-service-worker`,
    }
  }

  function sendJson(res: ServerResponse, body: unknown) {
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify(body))
  }

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    if (url.pathname === '/json/version') {
      sendJson(res, {
        Browser: 'billing-capture-harness',
        ProtocolVersion: '1.3',
      })
      return
    }
    if (url.pathname === '/json/list') {
      sendJson(res, [
        serviceWorkerDescriptor(),
        ...targetList().map(descriptor),
      ])
      return
    }
    if (url.pathname === '/json/new') {
      const targetUrl = url.searchParams.get('url') ?? ''
      const target = targetList().find(
        (entry) =>
          targetUrl === entry.url || targetUrl.startsWith(`${entry.url}/`)
      )
      if (!target) {
        res.statusCode = 404
        res.end()
        return
      }
      sendJson(res, descriptor(target))
      return
    }
    res.statusCode = 404
    res.end()
  })

  const wss = new WebSocketServer({ noServer: true })

  server.on('upgrade', (req, socket, head) => {
    const match = /^\/devtools\/page\/([A-Za-z0-9]+)$/.exec(
      new URL(req.url ?? '/', 'http://127.0.0.1').pathname
    )
    const target = match
      ? targetList().find((entry) => entry.id === match[1])
      : undefined
    if (!target) {
      socket.destroy()
      return
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      ws.on('error', () => {})
      ws.on('message', (data) => {
        void handleCdpMessage({
          target,
          connection: ws,
          text: messageText(data),
        })
      })
    })
  })

  function pageFetch(target: Target) {
    return async (url: string, init?: { headers?: Record<string, string> }) => {
      const resolved = new URL(url, target.url)
      if (
        requiresChatGptCredentials(resolved) &&
        !carriesChatGptCredentials(init?.headers)
      ) {
        return new Response('unauthenticated', { status: 401 })
      }
      if (requiresClaudeSession(resolved) && !claudeLoggedIn()) {
        return new Response('unauthenticated', { status: 401 })
      }
      const fixture = world.routes[url]
      if (!fixture) return new Response('no fixture', { status: 404 })
      return new Response(fixture.body, { status: fixture.status })
    }
  }

  function requiresChatGptCredentials(resolved: URL): boolean {
    return (
      resolved.origin === CHATGPT_ORIGIN &&
      resolved.pathname.startsWith('/backend-api/')
    )
  }

  function carriesChatGptCredentials(
    headers: Record<string, string> | undefined
  ): boolean {
    const session = chatGptSession()
    if (!session.accessToken || !session.accountId) return false
    return (
      headers?.Authorization === `Bearer ${session.accessToken}` &&
      headers?.['chatgpt-account-id'] === session.accountId
    )
  }

  function chatGptSession(): { accessToken?: string; accountId?: string } {
    const fixture = world.routes[CHATGPT_SESSION_ROUTE]
    if (!fixture || fixture.status !== 200) return {}
    let raw: unknown
    try {
      raw = JSON.parse(fixture.body)
    } catch {
      return {}
    }
    const parsed = sessionBody.safeParse(raw)
    if (!parsed.success) return {}
    return {
      accessToken: parsed.data.accessToken,
      accountId: parsed.data.account?.id,
    }
  }

  function requiresClaudeSession(resolved: URL): boolean {
    return (
      resolved.origin === CLAUDE_ORIGIN &&
      resolved.pathname !== CLAUDE_ORGANIZATIONS_ROUTE
    )
  }

  function claudeLoggedIn(): boolean {
    return world.routes[CLAUDE_ORGANIZATIONS_ROUTE]?.status === 200
  }

  async function handleCdpMessage(params: {
    target: Target
    connection: WebSocket
    text: string
  }) {
    let raw: unknown
    try {
      raw = JSON.parse(params.text)
    } catch {
      return
    }
    const parsed = cdpMessage.safeParse(raw)
    if (!parsed.success) return
    const { id, method } = parsed.data
    if (method === 'Runtime.evaluate') {
      const evaluate = evaluateParams.safeParse(parsed.data.params)
      if (!evaluate.success) {
        params.connection.send(
          JSON.stringify({
            id,
            error: { message: 'invalid Runtime.evaluate params' },
          })
        )
        return
      }
      const injected = nextEvaluateFailure
      if (injected) {
        if (injected.remaining > 1) injected.remaining -= 1
        else nextEvaluateFailure = undefined
        applyCdpFailure({
          connection: params.connection,
          id,
          failure: injected.failure,
        })
        return
      }
      await evaluateInTarget({
        target: params.target,
        connection: params.connection,
        id,
        expression: evaluate.data.expression,
      })
      return
    }
    if (method === 'Storage.getCookies') {
      params.connection.send(
        JSON.stringify({ id, result: { cookies: params.target.cookies } })
      )
      return
    }
    if (method === 'Browser.close') {
      params.connection.send(JSON.stringify({ id, result: {} }))
      params.connection.close()
      return
    }
    params.connection.send(
      JSON.stringify({
        id,
        error: { message: `unsupported CDP method ${method}` },
      })
    )
  }

  function applyCdpFailure(params: {
    connection: WebSocket
    id: number
    failure: CdpFailure
  }) {
    if (params.failure === 'disconnected') {
      params.connection.terminate()
      return
    }
    if (params.failure === 'protocol-error') {
      params.connection.send(
        JSON.stringify({
          id: params.id,
          error: { message: 'injected protocol error' },
        })
      )
      return
    }
    params.connection.send(
      JSON.stringify({ id: params.id, result: { result: {} } })
    )
  }

  async function evaluateInTarget(params: {
    target: Target
    connection: WebSocket
    id: number
    expression: string
  }) {
    const sandbox = {
      fetch: pageFetch(params.target),
      document: { readyState: 'complete' },
      AbortSignal,
    }
    try {
      const value = await runInNewContext(params.expression, sandbox)
      params.connection.send(
        JSON.stringify({ id: params.id, result: { result: { value } } })
      )
    } catch (error) {
      params.connection.send(
        JSON.stringify({
          id: params.id,
          result: { result: { exceptionDetails: { text: String(error) } } },
        })
      )
    }
  }

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const address = server.address()
  if (address === null || typeof address === 'string') {
    throw new Error('local server has no port')
  }
  const port = address.port

  let stopped = false
  async function stopServer(): Promise<void> {
    if (stopped) return
    stopped = true
    for (const client of wss.clients) client.terminate()
    await new Promise<void>((resolve) => {
      wss.close(() => resolve())
    })
    await new Promise<void>((resolve) => {
      server.close(() => resolve())
      server.closeAllConnections()
    })
  }

  return {
    ...userDeps,
    port,
    world,
    failNextEvaluate: (failure: CdpFailure, times = 1) => {
      nextEvaluateFailure = { failure, remaining: times }
    },
    openConnections: () => wss.clients.size,
    webSocketDebuggerUrl: (provider: Provider) =>
      webSocketDebuggerUrl(targets[provider]),
    stopServer,
    async [Symbol.asyncDispose]() {
      await stopServer()
    },
  }
}
