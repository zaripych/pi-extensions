import { extname } from 'node:path'
import { parse } from 'yaml'
import { z } from 'zod'
import { shortHash } from './shortHash'

const scoreRangeSchema = z.enum(['binary', 'triple'])

const fieldSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
})

const frontmatterSchema = z.object({
  name: z.string().optional(),
  'score-range': scoreRangeSchema,
  fields: z.array(fieldSchema).optional(),
})

export type Criteria = {
  name: string
  scoreRange: z.infer<typeof scoreRangeSchema>
  fields: string[]
  body: string
  criteriaHash: string
}

const frontmatterPattern = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/

export function parseCriteria(params: {
  source: string
  fileName: string
}): Criteria {
  const match = frontmatterPattern.exec(params.source)
  if (match === null) {
    throw new Error(
      `Criteria "${params.fileName}" is missing YAML frontmatter declaring score-range.`
    )
  }
  const [, rawFrontmatter, body] = match
  const parsed = frontmatterSchema.safeParse(parse(rawFrontmatter ?? ''))
  if (!parsed.success) {
    throw new Error(
      `Criteria "${params.fileName}" has an invalid score-range: it must be "binary" or "triple".`
    )
  }
  const fields = (parsed.data.fields ?? []).map((field) => field.name)
  if (fields.includes('sampleId')) {
    throw new Error(
      `Criteria "${params.fileName}" declares the field "sampleId", which is reserved: the CLI strips sampleId from every record before evaluation, so this field can never be supplied.`
    )
  }
  const extension = extname(params.fileName)
  const defaultName = extension.length > 0
    ? params.fileName.slice(0, -extension.length)
    : params.fileName
  return {
    name: parsed.data.name ?? defaultName,
    scoreRange: parsed.data['score-range'],
    fields,
    body: body ?? '',
    criteriaHash: shortHash(params.source),
  }
}
