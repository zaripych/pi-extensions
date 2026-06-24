import { type Api, type Model, type ProviderStreams } from '@earendil-works/pi-ai'
import { anthropicMessagesApi } from '@earendil-works/pi-ai/api/anthropic-messages.lazy'
import { azureOpenAIResponsesApi } from '@earendil-works/pi-ai/api/azure-openai-responses.lazy'
import { openAICodexResponsesApi } from '@earendil-works/pi-ai/api/openai-codex-responses.lazy'
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy'
import { openAIResponsesApi } from '@earendil-works/pi-ai/api/openai-responses.lazy'
import type { ModelRegistry } from '@earendil-works/pi-coding-agent'
import { z } from 'zod'

export type SingleShotRequest = <Output>(params: {
  prompt: string
  schema: z.ZodType<Output>
  seed: number
  signal?: AbortSignal
}) => Promise<Output>

const payloadSchema = z.record(z.string(), z.unknown())

function toJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const { $schema, ...rest } = z.toJSONSchema(schema)
  return rest
}

function injectStructuredOutput(params: {
  payload: unknown
  model: Model<Api>
  schema: z.ZodType
}): unknown {
  const jsonSchema = toJsonSchema(params.schema)
  const payload = payloadSchema.parse(params.payload)
  switch (params.model.api) {
    case 'openai-responses':
    case 'azure-openai-responses':
    case 'openai-codex-responses':
      return {
        ...payload,
        text: {
          ...payloadSchema.parse(payload.text ?? {}),
          format: {
            type: 'json_schema',
            name: 'response',
            strict: true,
            schema: jsonSchema,
          },
        },
      }
    case 'openai-completions':
      return {
        ...payload,
        response_format: {
          type: 'json_schema',
          json_schema: { name: 'response', strict: true, schema: jsonSchema },
        },
      }
    case 'anthropic-messages':
      return {
        ...payload,
        output_config: {
          ...payloadSchema.parse(payload.output_config ?? {}),
          format: { type: 'json_schema', schema: jsonSchema },
        },
      }
    default:
      throw new Error(
        `Structured output is not supported for the selected model API "${params.model.api}".`
      )
  }
}

function resolveApi(model: Model<Api>): ProviderStreams {
  switch (model.api) {
    case 'anthropic-messages':
      return anthropicMessagesApi()
    case 'openai-responses':
      return openAIResponsesApi()
    case 'azure-openai-responses':
      return azureOpenAIResponsesApi()
    case 'openai-codex-responses':
      return openAICodexResponsesApi()
    case 'openai-completions':
      return openAICompletionsApi()
    default:
      throw new Error(
        `Structured output is not supported for the selected model API "${model.api}".`
      )
  }
}

function extractText(content: { type: string }[]): string {
  return content
    .filter(
      (part): part is { type: 'text'; text: string } =>
        part.type === 'text' && 'text' in part
    )
    .map((part) => part.text)
    .join('')
}

export function createSingleShotRequest(params: {
  model: Model<Api>
  modelRegistry: Pick<ModelRegistry, 'getApiKeyAndHeaders'>
}): SingleShotRequest {
  return async ({ prompt, schema, signal }) => {
    const auth = await params.modelRegistry.getApiKeyAndHeaders(params.model)
    if (!auth.ok) {
      throw new Error(`Could not resolve model credentials: ${auth.error}`)
    }
    const stream = resolveApi(params.model).streamSimple(
      params.model,
      {
        messages: [{ role: 'user', content: prompt, timestamp: Date.now() }],
      },
      {
        apiKey: auth.apiKey,
        headers: auth.headers,
        signal,
        onPayload: (payload) =>
          injectStructuredOutput({ payload, model: params.model, schema }),
      }
    )
    const message = await stream.result()
    if (message.stopReason === 'error' || message.stopReason === 'aborted') {
      throw new Error(
        `Model request failed (${message.stopReason}): ${message.errorMessage ?? 'unknown error'}`
      )
    }
    const text = extractText(message.content)
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch (cause) {
      throw new Error(`Model did not return valid structured output: ${text}`, {
        cause,
      })
    }
    return schema.parse(parsed)
  }
}
