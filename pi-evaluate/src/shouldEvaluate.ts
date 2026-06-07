import type { Sample } from './evaluateSamples'
import type { Criterion } from './parseCriterion'

export function shouldEvaluate(params: {
  sample: Sample
  criterion: Criterion
}): { should: boolean; description?: string } {
  if (params.criterion.fields.length === 0) {
    return { should: true }
  }
  const sample = params.sample
  if (typeof sample === 'string') {
    return {
      should: false,
      description: `A text sample cannot supply the declared field(s): ${params.criterion.fields.join(', ')}.`,
    }
  }
  const missing = params.criterion.fields.filter(
    (field) => !Object.hasOwn(sample, field)
  )
  if (missing.length > 0) {
    return {
      should: false,
      description: `Sample is missing declared field(s): ${missing.join(', ')}.`,
    }
  }
  return { should: true }
}
