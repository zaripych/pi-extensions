import { Value } from 'typebox/value'
import { type ReviewOutput, reviewOutputSchema } from './reviewOutputSchema'

type ToolEvent = {
  type: string
  toolName?: string
  result?: unknown
  isError?: boolean
}

export function extractReviewOutput(
  events: ToolEvent[]
): ReviewOutput | undefined {
  for (const event of events) {
    if (
      event.type === 'tool_execution_end' &&
      event.toolName === 'finish-review' &&
      !event.isError
    ) {
      const result = event.result
      if (
        typeof result === 'object' &&
        result !== null &&
        'details' in result
      ) {
        const { details } = result
        if (Value.Check(reviewOutputSchema, details)) {
          return details
        }
      }
    }
  }

  return undefined
}
