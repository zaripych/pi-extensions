import { StringEnum } from '@earendil-works/pi-ai'
import { type Static, Type } from 'typebox'

export const findingSchema = Type.Object({
  title: Type.String({
    description: 'Max 80 chars, imperative mood.',
  }),
  body: Type.String({
    description: 'Markdown explaining why this is a problem.',
  }),
  confidence_score: Type.Number({
    minimum: 0,
    maximum: 1,
    description: 'Confidence score for this finding (0.0-1.0).',
  }),
  priority: Type.Optional(
    Type.Integer({
      minimum: 0,
      maximum: 3,
      description:
        'P0 = drop-everything blocker; P1 = urgent; P2 = normal; P3 = nice-to-have.',
    })
  ),
  code_location: Type.Object(
    {
      absolute_file_path: Type.String({
        description: 'Absolute path to the file containing the issue.',
      }),
      line_range: Type.Object({
        start: Type.Integer({
          minimum: 1,
          description: 'First line (1-indexed).',
        }),
        end: Type.Integer({
          minimum: 1,
          description: 'Last line (1-indexed).',
        }),
      }),
    },
    { description: 'Location in the file where the issue occurs.' }
  ),
})

export const reviewOutputSchema = Type.Object({
  findings: Type.Array(findingSchema, { maxItems: 50 }),
  overall_correctness: StringEnum(
    ['patch is correct', 'patch is incorrect'] as const,
    {
      description: 'Verdict on whether the patch is correct.',
    }
  ),
  overall_explanation: Type.String({
    description: '1-3 sentence summary of the review.',
  }),
  overall_confidence_score: Type.Number({
    minimum: 0,
    maximum: 1,
    description: 'Overall confidence in the review (0.0-1.0).',
  }),
})

export type Finding = Static<typeof findingSchema>
export type ReviewOutput = Static<typeof reviewOutputSchema>
