import { cp, mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { format } from 'node:util'
import { openBrowserSession, type BrowserSession } from './browser'
import { claudeOrgId, probeClaudeLogin } from './anthropic/login'
import { ANTHROPIC_ROUTES } from './anthropic/routes'
import type { FetchPage, RawResponse } from './fetchInPage'
import {
  fetchWithPagination,
  type Route,
  type StopReason,
} from './fetchWithPagination'
import { statIfPresent } from './fsIfPresent'
import { DEFAULT_CAPTURE_DIR } from './loadCapture'
import { probeNeuralwattLogin } from './neuralwatt/login'
import { NEURALWATT_ROUTES } from './neuralwatt/routes'
import {
  chatGptAccessToken,
  chatgptAccountId,
  probeChatGptLogin,
} from './openai/login'
import { CHATGPT_ROUTES } from './openai/routes'

type RouteEntry = {
  status: number | 'error'
  stopReason?: StopReason
  durationMs: number
  error?: unknown
}

const manifestReplacer = (key: string, value: unknown): unknown =>
  key === 'error' && value !== undefined ? format(value) : value

/** Widened route: every table entry is assignable to it (schema covariance,
 * bivariant pagination spec). */
type AnyRoute = Route<object, unknown>

export type CaptureResult = {
  ok: boolean
  needsLogin: boolean
  artifactsPath: string
  routes: Record<string, RouteEntry>
  error?: string
}

type Manifest = {
  startedAt: string
  chatgptAccountId?: string
  claudeOrgId?: string
  probes: {
    chatgptSessionStatus: number
    claudeOrganizationsStatus: number
    neuralwattBillingStatus: number
  }
  routes: Record<string, RouteEntry>
}

const defaultDeps = {
  openBrowserSession,
  isInteractiveTerminal: () => process.stdin.isTTY === true,
  waitForEnter,
  createStageDir,
}

/** One capture run: every response is staged in a fresh `$TMPDIR`
 * artifacts directory; on full success the staged route files replace the
 * capture directory wholesale. Any failure publishes nothing and keeps the
 * artifacts directory. */
export async function capture(
  params: {
    port?: number
    captureDir?: string
    keepOpen?: boolean
  },
  deps = defaultDeps
): Promise<CaptureResult> {
  const stagePath = await deps.createStageDir()
  const filesDir = join(stagePath, 'files')
  await mkdir(filesDir)
  const routes: Record<string, RouteEntry> = {}
  const manifest: Manifest = {
    startedAt: new Date().toISOString(),
    probes: {
      chatgptSessionStatus: 0,
      claudeOrganizationsStatus: 0,
      neuralwattBillingStatus: 0,
    },
    routes,
  }
  let session: BrowserSession | undefined
  try {
    session = await deps.openBrowserSession({
      port: params.port,
      keepOpen: params.keepOpen,
    })
    const probes = await waitForLogins(
      {
        chatgpt: session.chatgpt,
        claude: session.claude,
        neuralwatt: session.neuralwatt,
      },
      deps
    )
    manifest.probes = {
      chatgptSessionStatus: probes.chatgpt.response.status,
      claudeOrganizationsStatus: probes.claude.response.status,
      neuralwattBillingStatus: probes.neuralwatt.response.status,
    }
    if (probes.chatgpt.response.status !== 200) {
      await writeFile(
        join(stagePath, 'probe-chatgpt-session.json'),
        probes.chatgpt.response.body
      )
    }
    await writeFile(
      join(stagePath, 'probe-claude-organizations.json'),
      probes.claude.response.body
    )
    if (!probes.neuralwatt.isAuthenticated) {
      await writeFile(
        join(stagePath, 'probe-neuralwatt-billing.html'),
        probes.neuralwatt.response.body
      )
    }
    if (
      !probes.chatgpt.isAuthenticated ||
      !probes.claude.isAuthenticated ||
      !probes.neuralwatt.isAuthenticated
    ) {
      return {
        ok: false,
        needsLogin: true,
        artifactsPath: stagePath,
        routes,
        error: `login probes failed: ${loginProbeSummaries({ probes })}`,
      }
    }
    manifest.chatgptAccountId = chatgptAccountId({
      body: probes.chatgpt.response.body,
    })
    manifest.claudeOrgId = claudeOrgId({ response: probes.claude.response })
    if (!manifest.chatgptAccountId) {
      return {
        ok: false,
        needsLogin: false,
        artifactsPath: stagePath,
        routes,
        error: 'chatgpt account id not found in /api/auth/session',
      }
    }
    if (!manifest.claudeOrgId) {
      return {
        ok: false,
        needsLogin: false,
        artifactsPath: stagePath,
        routes,
        error: 'claude org id not found in /api/organizations',
      }
    }
    const accessToken = chatGptAccessToken({
      body: probes.chatgpt.response.body,
    })
    if (!accessToken) {
      return {
        ok: false,
        needsLogin: false,
        artifactsPath: stagePath,
        routes,
        error: 'chatgpt session token unavailable',
      }
    }
    const headers = chatGptHeaders({
      chatgptAccountId: manifest.chatgptAccountId,
      accessToken,
      deviceId: await session.chatgptDeviceId(),
    })
    for (const route of Object.values(CHATGPT_ROUTES)) {
      routes[route.file] = await runRoute({
        route,
        page: session.chatgpt,
        headers,
        chatgptAccountId: manifest.chatgptAccountId,
        claudeOrgId: manifest.claudeOrgId,
        filesDir,
      })
    }
    for (const route of Object.values(ANTHROPIC_ROUTES)) {
      routes[route.file] = await runRoute({
        route,
        page: session.claude,
        chatgptAccountId: manifest.chatgptAccountId,
        claudeOrgId: manifest.claudeOrgId,
        filesDir,
      })
    }
    for (const route of Object.values(NEURALWATT_ROUTES)) {
      routes[route.file] = await runRoute({
        route,
        page: session.neuralwatt,
        chatgptAccountId: manifest.chatgptAccountId,
        claudeOrgId: manifest.claudeOrgId,
        filesDir,
      })
    }
    if (!Object.values(routes).every((entry) => entry.status === 200)) {
      return {
        ok: false,
        needsLogin: false,
        artifactsPath: stagePath,
        routes,
        error:
          'one or more routes failed — nothing published; see manifest.json in the artifacts directory',
      }
    }
    await publish({
      filesDir,
      captureDir: params.captureDir ?? DEFAULT_CAPTURE_DIR,
    })
    return { ok: true, needsLogin: false, artifactsPath: stagePath, routes }
  } finally {
    try {
      await writeFile(
        join(stagePath, 'manifest.json'),
        JSON.stringify(manifest, manifestReplacer, 2)
      )
    } finally {
      await session?.close()
    }
  }
}

capture.defaultDeps = defaultDeps

async function createStageDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'pi-billing-capture-'))
}

async function waitForEnter(): Promise<void> {
  const readline = createInterface({
    input: process.stdin,
    output: process.stderr,
  })
  await readline.question(
    'Log in or clear the challenge in the browser window, then press Enter to continue: '
  )
  readline.close()
}

async function waitForLogins(
  params: { chatgpt: FetchPage; claude: FetchPage; neuralwatt: FetchPage },
  deps = defaultDeps
) {
  let probes = await probeLogins(params)
  if (
    probes.chatgpt.isAuthenticated &&
    probes.claude.isAuthenticated &&
    probes.neuralwatt.isAuthenticated
  ) {
    return probes
  }
  if (!deps.isInteractiveTerminal()) return probes
  await deps.waitForEnter()
  return await probeLogins(params)
}

async function probeLogins(params: {
  chatgpt: FetchPage
  claude: FetchPage
  neuralwatt: FetchPage
}) {
  return {
    chatgpt: await probeChatGptLogin({ page: params.chatgpt }),
    claude: await probeClaudeLogin({ page: params.claude }),
    neuralwatt: await probeNeuralwattLogin({ page: params.neuralwatt }),
  }
}

function loginProbeSummaries(params: {
  probes: Record<string, { response: RawResponse; isAuthenticated: boolean }>
}): string {
  return Object.entries(params.probes)
    .map(
      ([name, probe]) =>
        `${name} ${probe.response.status} (${probe.isAuthenticated ? 'authenticated' : 'unauthenticated'})`
    )
    .join(', ')
}

function chatGptHeaders(params: {
  chatgptAccountId: string
  accessToken: string
  deviceId?: string
}): Record<string, string> {
  const headers: Record<string, string> = {
    'chatgpt-account-id': params.chatgptAccountId,
    Authorization: `Bearer ${params.accessToken}`,
  }
  if (params.deviceId) headers['OAI-Device-Id'] = params.deviceId
  return headers
}

async function runRoute(params: {
  route: AnyRoute
  page: FetchPage
  headers?: Record<string, string>
  chatgptAccountId: string
  claudeOrgId: string
  filesDir: string
}): Promise<RouteEntry> {
  const started = Date.now()
  const url = params.route.path
    .replace('{account}', params.chatgptAccountId)
    .replace('{org}', params.claudeOrgId)
  try {
    if (!params.route.paginate) {
      const response = await params.page.fetch({ url, headers: params.headers })
      if (response.status !== 200)
        throw new Error(`route ${url} answered ${response.status}`)
      if (params.route.parse) {
        // parse validates: the staged artifact is the extracted, normalized
        // JSON, so loadCapture re-validates it like every other route file;
        // JSON routes keep staging the raw body
        const parsed = await params.route.parse(response.body)
        await writeFile(
          join(params.filesDir, `${params.route.file}.json`),
          JSON.stringify(parsed, null, 2)
        )
        return { status: response.status, durationMs: Date.now() - started }
      }
      params.route.schema.parse(JSON.parse(response.body))
      await writeFile(
        join(params.filesDir, `${params.route.file}.json`),
        response.body
      )
      return { status: response.status, durationMs: Date.now() - started }
    }
    const result = await fetchWithPagination({
      page: params.page,
      url,
      headers: params.headers,
      schema: params.route.schema,
      spec: params.route.paginate,
    })
    for (const [index, response] of result.pages.entries()) {
      const pageNumber = String(index + 1).padStart(3, '0')
      await writeFile(
        join(params.filesDir, `${params.route.file}.page-${pageNumber}.json`),
        response.body
      )
    }
    return {
      status: 200,
      stopReason: result.stopReason,
      durationMs: Date.now() - started,
    }
  } catch (error) {
    return {
      status: 'error',
      durationMs: Date.now() - started,
      error,
    }
  }
}

/** Directory swap: the staged files are copied to a sibling of the capture
 * directory, then moved in with two same-volume renames — the capture
 * directory is replaced wholesale, so stale page files never leak into a
 * merged view, and a crash between the renames leaves the old directory
 * beside the new one, never a mix. */
async function publish(params: {
  filesDir: string
  captureDir: string
}): Promise<void> {
  const parent = dirname(params.captureDir)
  await mkdir(parent, { recursive: true })
  const incoming = join(parent, `${basename(params.captureDir)}.incoming`)
  const previous = join(parent, `${basename(params.captureDir)}.previous`)
  await rm(incoming, { recursive: true, force: true })
  await rm(previous, { recursive: true, force: true })
  await cp(params.filesDir, incoming, { recursive: true })
  if (await statIfPresent(params.captureDir)) {
    await rename(params.captureDir, previous)
  }
  await rename(incoming, params.captureDir)
  await rm(previous, { recursive: true, force: true })
}
