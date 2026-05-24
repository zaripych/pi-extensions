import { addAbortListener } from 'node:events'
import {
  AuthStorage,
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  ModelRegistry,
  SessionManager,
  SettingsManager,
} from '@earendil-works/pi-coding-agent'
import type { LoadedConfig } from '../config/loadConfig'
import { finishReviewTool } from '../finish-review/finishReviewTool'
import { extractReviewOutput } from '../review-output/extractReviewOutput'
import { filterFindings } from '../review-output/filterFindings'
import type { ReviewOutput } from '../review-output/reviewOutputSchema'
import { reviewerGitTool } from '../reviewer-git/reviewerGitTool'

function formatSessionError(params: {
  errorMessage: string | undefined
  sessionId: string
  sessionFile: string | undefined
}): string | undefined {
  if (!params.errorMessage) return undefined
  const lines = [params.errorMessage, '']
  lines.push(`Session: ${params.sessionId}`)
  if (params.sessionFile) {
    lines.push(`Session file: ${params.sessionFile}`)
  }
  return lines.join('\n')
}

export async function runReviewSession(params: {
  config: LoadedConfig
  cwd: string
  modelId: string
  taskPrompt: string
  signal?: AbortSignal
}): Promise<
  { output: ReviewOutput } | { error: string } | { cancelled: true }
> {
  const { config, cwd, modelId, taskPrompt } = params

  if (params.signal?.aborted) {
    return { cancelled: true }
  }

  const [provider, ...rest] = modelId.split('/')
  const id = rest.join('/')
  if (!provider) {
    throw new Error(`Invalid model ID format: ${modelId}`)
  }

  const authStorage = AuthStorage.create()
  const modelRegistry = ModelRegistry.create(authStorage)
  const model = modelRegistry.find(provider, id)
  if (!model) {
    throw new Error(`Model not found: ${modelId}`)
  }

  const agentDir = getAgentDir()

  const loader = new DefaultResourceLoader({
    cwd,
    agentDir,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noContextFiles: true,
    systemPromptOverride: () => config.systemPromptContent,
  })
  await loader.reload()

  const sessionManager = SessionManager.create(cwd)

  const { session } = await createAgentSession({
    cwd,
    agentDir,
    model,
    tools: [...config.tools, 'reviewer-git', 'finish-review'],
    customTools: [reviewerGitTool, finishReviewTool],
    resourceLoader: loader,
    sessionManager,
    settingsManager: SettingsManager.inMemory(),
    authStorage,
    modelRegistry,
  })

  const toolEndEvents: {
    type: string
    toolName?: string
    result?: unknown
    isError?: boolean
  }[] = []
  let sessionError: string | undefined

  const unsubscribe = session.subscribe((event) => {
    if (event.type === 'tool_execution_end') {
      toolEndEvents.push({
        type: event.type,
        toolName: event.toolName,
        result: event.result,
        isError: event.isError,
      })
    } else if (event.type === 'agent_end') {
      for (const message of event.messages) {
        if (
          'stopReason' in message &&
          message.stopReason === 'error' &&
          'errorMessage' in message &&
          typeof message.errorMessage === 'string'
        ) {
          sessionError = message.errorMessage
        }
      }
    }
  })

  let abortPromise: Promise<void> | undefined

  await using _session = {
    async [Symbol.asyncDispose]() {
      unsubscribe()
      await abortPromise?.catch(() => undefined)
      session.dispose()
    },
  }

  using _abortListener = params.signal
    ? addAbortListener(params.signal, () => {
        abortPromise = session.abort()
      })
    : undefined

  if (params.signal?.aborted) {
    return { cancelled: true }
  }

  try {
    await session.prompt(taskPrompt)
  } catch (error) {
    if (params.signal?.aborted) {
      return { cancelled: true }
    }
    throw error
  }

  if (params.signal?.aborted) {
    return { cancelled: true }
  }

  const rootEntry = session.sessionManager.getEntries()[0]
  if (rootEntry) {
    session.sessionManager.appendLabelChange(rootEntry.id, 'review')
  }

  const output = extractReviewOutput(toolEndEvents)
  if (!output) {
    const error =
      formatSessionError({
        errorMessage: sessionError,
        sessionId: sessionManager.getSessionId(),
        sessionFile: sessionManager.getSessionFile(),
      }) ?? 'Reviewer produced no structured output.'
    return { error }
  }
  return { output: filterFindings({ output, thresholds: config.thresholds }) }
}
