import { normalizeModelId } from '../normalizeModelId'
import { loadAaModels } from './loadAaModels'

const defaultDeps = { loadAaModels }

/** Resolves the AA intelligence index per requested model name; models
 * without a match or evaluation get no entry. */
export async function resolveAaScores(
  params: { models: string[]; now: Date },
  deps = defaultDeps
): Promise<Map<string, number>> {
  const aaModels = await deps.loadAaModels({ now: params.now })
  const scoreByNormalizedId = new Map<string, number>()
  for (const aaModel of aaModels) {
    const index = aaModel.evaluations.artificial_analysis_intelligence_index
    if (index === null) continue
    for (const field of [aaModel.slug, aaModel.name]) {
      const key = normalizeModelId(field)
      if (key.length > 0 && !scoreByNormalizedId.has(key)) {
        scoreByNormalizedId.set(key, index)
      }
    }
  }
  const scores = new Map<string, number>()
  for (const model of params.models) {
    const score = scoreByNormalizedId.get(normalizeModelId(model))
    if (score !== undefined) scores.set(model, score)
  }
  return scores
}

resolveAaScores.defaultDeps = defaultDeps
