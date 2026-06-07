import { AuthStorage, ModelRegistry } from '@earendil-works/pi-coding-agent'
import { createSingleShotRequest, type SingleShotRequest } from './singleShotRequest'

export function createCliRequestOutput(params: {
  model: string
}): { singleShotRequest: SingleShotRequest } {
  const [provider, ...rest] = params.model.split('/')
  const id = rest.join('/')
  if (provider === undefined || provider.length === 0 || id.length === 0) {
    throw new Error(`Invalid model id "${params.model}" (expected provider/id).`)
  }
  const authStorage = AuthStorage.create()
  const modelRegistry = ModelRegistry.create(authStorage)
  const model = modelRegistry.find(provider, id)
  if (model === undefined) {
    throw new Error(`Model not found: ${params.model}`)
  }
  return { singleShotRequest: createSingleShotRequest({ model, modelRegistry }) }
}
