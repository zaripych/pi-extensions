import { z, type ZodType } from 'zod'

const responseEnvelope = z.object({
  id: z.number(),
  result: z.unknown().optional(),
  error: z.unknown().optional(),
})
const responseError = z.object({ message: z.string() })

const evaluateResponse = z.object({
  result: z.object({ value: z.unknown().optional() }).optional(),
  exceptionDetails: z.object({}).optional(),
})
const cookiesResponse = z.object({
  cookies: z.array(z.object({ name: z.string(), value: z.string() })),
})

export type EvaluateResponse = z.infer<typeof evaluateResponse>

type PendingEntry = {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
}

export class CdpProtocol {
  private readonly ws: WebSocket
  private nextId = 0
  private closed = false
  private readonly pending = new Map<number, PendingEntry>()

  constructor(ws: WebSocket) {
    this.ws = ws
    ws.addEventListener('close', () => {
      this.closed = true
      for (const entry of this.pending.values()) {
        entry.reject(new Error('connection closed'))
      }
      this.pending.clear()
    })
    ws.addEventListener('message', (event) => {
      let parsed: unknown
      try {
        parsed = JSON.parse(String(event.data))
      } catch {
        return
      }
      const envelope = responseEnvelope.safeParse(parsed)
      if (!envelope.success) return
      const entry = this.pending.get(envelope.data.id)
      if (entry === undefined) return
      this.pending.delete(envelope.data.id)
      if (envelope.data.error !== undefined) {
        const error = responseError.safeParse(envelope.data.error)
        entry.reject(
          new Error(error.success ? error.data.message : 'CDP error')
        )
        return
      }
      entry.resolve(envelope.data.result)
    })
  }

  static async connect(url: string): Promise<CdpProtocol> {
    const ws = new WebSocket(url)
    await new Promise<void>((resolve, reject) => {
      ws.addEventListener('open', () => resolve())
      ws.addEventListener('error', () =>
        reject(new Error(`cannot connect to ${url}`))
      )
    })
    return new CdpProtocol(ws)
  }

  async send<T>(params: {
    method: string
    args?: Record<string, unknown>
    schema: ZodType<T>
    signal?: AbortSignal
  }): Promise<T> {
    if (this.closed) throw new Error('connection closed')
    const id = ++this.nextId
    const signal = params.signal
    const raw = await new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      signal?.addEventListener(
        'abort',
        () => {
          if (this.pending.delete(id)) reject(signal.reason)
        },
        { once: true }
      )
      this.ws.send(
        JSON.stringify({ id, method: params.method, params: params.args ?? {} })
      )
    })
    return params.schema.parse(raw)
  }

  async evaluate(params: {
    expression: string
    awaitPromise?: boolean
  }): Promise<EvaluateResponse> {
    return this.send({
      method: 'Runtime.evaluate',
      args: {
        expression: params.expression,
        awaitPromise: params.awaitPromise === true,
        returnByValue: true,
      },
      schema: evaluateResponse,
    })
  }

  async cookieValue(name: string): Promise<string | undefined> {
    const response = await this.send({
      method: 'Storage.getCookies',
      schema: cookiesResponse,
    })
    return response.cookies.find((cookie) => cookie.name === name)?.value
  }

  async closeBrowser(params: { signal?: AbortSignal } = {}): Promise<void> {
    await this.send({
      method: 'Browser.close',
      schema: z.unknown(),
      signal: params.signal,
    })
  }

  close(): void {
    this.ws.close()
  }
}
