import { z } from 'zod'

export const aaPageSchema = z.object({
  data: z.array(
    z.object({
      slug: z.string(),
      name: z.string(),
      evaluations: z.object({
        // the language-model intelligence index
        artificial_analysis_intelligence_index: z.number().nullable(),
      }),
    })
  ),
  pagination: z.object({ has_more: z.boolean() }).optional(),
})

export type AaPage = z.infer<typeof aaPageSchema>
export type AaModel = AaPage['data'][number]
