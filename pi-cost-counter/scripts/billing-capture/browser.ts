import { spawn } from 'node:child_process'
import { access, constants } from 'node:fs/promises'
import { createServer } from 'node:net'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import { CdpProtocol } from './cdpProtocol'
import { fetchInPage, type FetchPage } from './fetchInPage'
import { sleep } from './sleep'

const PROFILE_DIR = join(homedir(), '.cache', 'pi-billing-chrome')

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
]

/** The session's public surface is the thin fetchable page — CDP connections
 * stay internal to the browser session. */
export type BrowserSession = {
  chatgpt: FetchPage
  claude: FetchPage
  neuralwatt: FetchPage
  chatgptDeviceId(): Promise<string | undefined>
  close(): Promise<void>
}

/** Everything openBrowserSession needs from a launched browser: where the
 * debug endpoint listens, how to make the browser go away, and when it is
 * actually gone. */
type BrowserLaunch = {
  port: number
  exited: Promise<void>
  shutdown: () => Promise<void>
}

const defaultDeps = {
  spawnBrowser,
  sleep,
}

export async function openBrowserSession(
  params: { port?: number; keepOpen?: boolean },
  deps = defaultDeps
): Promise<BrowserSession> {
  let port = params.port
  let shutdown: (() => Promise<void>) | undefined
  let exited: Promise<void> | undefined
  if (port !== undefined && (await debugEndpointAlive(port))) {
  } else {
    if (port !== undefined) {
      console.error('could not attach to the browser — launching a new one', {
        port,
      })
    }
    const spawned = await deps.spawnBrowser()
    port = spawned.port
    exited = spawned.exited
    shutdown = spawned.shutdown
  }
  const launchedByUs = shutdown !== undefined
  const connections: CdpProtocol[] = []
  // on failure this releases the connections and the browser before the
  // error escapes; move() hands ownership away on success
  await using initCleanup = new AsyncDisposableStack()
  initCleanup.defer(() =>
    closeSession({
      connections,
      launchedByUs,
      exited,
      shutdown,
      keepOpen: false,
    }).catch((error) => {
      console.error('browser cleanup after failed initialization failed', {
        error,
      })
    })
  )
  const chatgpt = await connectTab({
    port,
    url: 'https://chatgpt.com',
    connections,
  })
  const claude = await connectTab({
    port,
    url: 'https://claude.ai',
    connections,
  })
  const neuralwatt = await connectTab({
    port,
    url: 'https://portal.neuralwatt.com',
    connections,
  })
  await waitForReady(chatgpt, deps)
  await waitForReady(claude, deps)
  await waitForReady(neuralwatt, deps)
  initCleanup.move()
  const onSigint = () => {
    console.error('interrupted — closing the browser')
    void closeSession({
      connections,
      launchedByUs,
      exited,
      shutdown,
      keepOpen: false,
    })
      .catch((error) => {
        console.error('browser shutdown failed', { error })
      })
      .finally(() => {
        // exitCode, not exit — a forced exit would truncate the messages
        // above when stdout is a pipe; the fallback timer reaps any handle
        // that would otherwise keep an interrupted process alive
        process.exitCode = 130
        setTimeout(() => process.exit(130), 1000).unref()
      })
  }
  process.once('SIGINT', onSigint)
  return {
    chatgpt: forPage(chatgpt),
    claude: forPage(claude),
    neuralwatt: forPage(neuralwatt),
    chatgptDeviceId: async () => chatgpt.cookieValue('oai-did'),
    close: async () => {
      process.removeListener('SIGINT', onSigint)
      await closeSession({
        connections,
        launchedByUs,
        exited,
        shutdown,
        keepOpen: params.keepOpen === true,
      })
    },
  }
}

openBrowserSession.defaultDeps = defaultDeps

async function spawnBrowser(): Promise<BrowserLaunch> {
  let spawnError: Error | undefined
  // a reserved port cannot belong to another process's browser
  const port = await findFreePort()
  const child = spawn(
    await findChrome(),
    [
      `--user-data-dir=${PROFILE_DIR}`,
      `--remote-debugging-port=${port}`,
      '--no-first-run',
      '--no-default-browser-check',
    ],
    { stdio: 'ignore', detached: true }
  )
  child.once('error', (error) => {
    spawnError = error
  })
  child.unref()
  for (let attempt = 0; attempt < 30; attempt++) {
    if (spawnError)
      throw new Error('browser failed to start', { cause: spawnError })
    if (await debugEndpointAlive(port)) {
      return {
        port,
        // resolves when the browser process is truly gone — Browser.close is
        // acknowledged ~1s before the process exits, and a capture CLI's
        // final output must not race that exit
        exited: Promise.race([
          new Promise<void>((resolve) => {
            child.once('exit', () => resolve())
          }),
          // ponytail: 10s cap — a browser that refuses to die must not hang
          // the capture; the next launch reuses the profile anyway
          sleep(10_000),
        ]),
        shutdown: async () => {
          child.kill('SIGTERM')
        },
      }
    }
    await sleep(500)
  }
  // the detached child would otherwise hold the profile and block later launches
  child.kill('SIGTERM')
  throw new Error(`browser did not expose the debug endpoint on port ${port}`)
}

async function findFreePort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const address = server.address()
  if (address === null || typeof address === 'string') {
    throw new Error('could not reserve a debug port')
  }
  await new Promise<void>((resolve) => {
    server.close(() => resolve())
  })
  return address.port
}

async function connectTab(params: {
  port: number
  url: string
  connections: CdpProtocol[]
}): Promise<CdpProtocol> {
  const origin = new URL(params.url).origin
  for (const tab of await listTabs(params.port)) {
    if (tab.url === origin || tab.url.startsWith(`${origin}/`)) {
      const connection = await CdpProtocol.connect(tab.webSocketDebuggerUrl)
      params.connections.push(connection)
      return connection
    }
  }
  return await openTab(params)
}

const tabEntry = z.object({
  url: z.string().min(1),
  // non-page targets such as service workers expose no document
  type: z.literal('page'),
  webSocketDebuggerUrl: z.string().min(1),
})

async function listTabs(
  port: number
): Promise<Array<{ url: string; webSocketDebuggerUrl: string }>> {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`, {
    signal: AbortSignal.timeout(5000),
  })
  const targets = z.array(z.unknown()).parse(await response.json())
  const tabs: Array<{ url: string; webSocketDebuggerUrl: string }> = []
  for (const target of targets) {
    const parsed = tabEntry.safeParse(target)
    if (parsed.success) tabs.push(parsed.data)
  }
  return tabs
}

async function waitForReady(
  connection: CdpProtocol,
  deps: typeof defaultDeps
): Promise<void> {
  for (let attempt = 0; attempt < 30; attempt++) {
    const state = await evaluateString(connection, 'document.readyState').catch(
      () => ''
    )
    if (state === 'complete' || state === 'interactive') {
      await deps.sleep(2000)
      return
    }
    await deps.sleep(1000)
  }
  throw new Error('page did not become ready')
}

async function evaluateString(
  connection: CdpProtocol,
  expression: string
): Promise<string> {
  const value = (await connection.evaluate({ expression })).result?.value
  return typeof value === 'string' ? value : ''
}

async function openTab(params: {
  port: number
  url: string
  connections: CdpProtocol[]
}): Promise<CdpProtocol> {
  let target: unknown
  for (const method of ['PUT', 'GET'] as const) {
    const response = await fetch(
      `http://127.0.0.1:${params.port}/json/new?${encodeURIComponent(params.url)}`,
      { method, signal: AbortSignal.timeout(5000) }
    )
    if (response.ok) {
      target = await response.json()
      break
    }
  }
  const parsed = tabEntry.safeParse(target)
  if (!parsed.success) throw new Error(`cannot open tab for ${params.url}`)
  const connection = await CdpProtocol.connect(parsed.data.webSocketDebuggerUrl)
  params.connections.push(connection)
  return connection
}

async function closeSession(params: {
  connections: CdpProtocol[]
  launchedByUs: boolean
  exited?: Promise<void>
  shutdown?: () => Promise<void>
  keepOpen: boolean
}): Promise<void> {
  if (!params.launchedByUs || params.keepOpen) {
    for (const connection of params.connections) connection.close()
    return
  }
  for (const connection of params.connections) {
    try {
      await connection.closeBrowser({ signal: AbortSignal.timeout(3000) })
      // Browser.close returns before the process exits; waiting for the
      // exit keeps the caller's output out of the race with the browser
      // dying — its exit lands after anything printed now
      await params.exited
      return
    } catch {
      continue
    }
  }
  await params.shutdown?.()
  await params.exited
}

async function debugEndpointAlive(port: number): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/version`, {
      signal: AbortSignal.timeout(1000),
    })
    return response.ok
  } catch {
    return false
  }
}

/** access(X_OK) failure — including EACCES — means the candidate is not
 * usable by this process; that is the answer, not an error. */
async function findChrome(): Promise<string> {
  for (const candidate of CHROME_CANDIDATES) {
    if (!candidate) continue
    if (
      await access(candidate, constants.X_OK).then(
        () => true,
        () => false
      )
    ) {
      return candidate
    }
  }
  throw new Error(
    'no Chromium browser found — set CHROME_PATH to your browser executable'
  )
}

function forPage(cdp: CdpProtocol): FetchPage {
  return {
    fetch: (fetchParams) =>
      fetchInPage({ cdp, url: fetchParams.url, headers: fetchParams.headers }),
  }
}
