import type { Sample } from './evaluateSamples'
import type { Criteria } from './parseCriteria'

export function shouldEvaluate(params: {
  sample: Sample
  geval: Criteria
}): { should: boolean; description?: string } {
  if (params.geval.fields.length === 0) {
    return { should: true }
  }
  if ('text' in params.sample) {
    return {
      should: false,
      description: `A text sample cannot supply the declared field(s): ${params.geval.fields.join(', ')}.`,
    }
  }
  const record = params.sample.record
  const missing = params.geval.fields.filter(
    (field) => !Object.hasOwn(record, field)
  )
  if (missing.length > 0) {
    return {
      should: false,
      description: `Sample is missing declared field(s): ${missing.join(', ')}.`,
    }
  }
  return { should: true }
}
