import { ModelRuntime } from '@earendil-works/pi-coding-agent'
import {
  createSingleShotRequest,
  type SingleShotRequest,
} from './singleShotRequest'

export async function createCliRequestOutput(params: {
  model: string
}): Promise<{ singleShotRequest: SingleShotRequest }> {
  const [provider, ...rest] = params.model.split('/')
  const id = rest.join('/')
  if (provider === undefined || provider.length === 0 || id.length === 0) {
    throw new Error(
      `Invalid model id "${params.model}" (expected provider/id).`
    )
  }
  const modelRuntime = await ModelRuntime.create()
  const model = modelRuntime.getModel(provider, id)
  if (model === undefined) {
    throw new Error(`Model not found: ${params.model}`)
  }
  return { singleShotRequest: createSingleShotRequest({ model, modelRuntime }) }
}
