import type { Api, Model } from '@earendil-works/pi-ai'
import {
  ModelRuntime,
  type ModelRegistry,
} from '@earendil-works/pi-coding-agent'

export function createModelRuntimeFromModelRegistry(params: {
  modelRegistry: ModelRegistry
}): (modelId: string) => Promise<{
  model: Model<Api> | undefined
  modelRuntime: ModelRuntime
}> {
  return async (modelId) => {
    const [provider, ...rest] = modelId.split('/')
    const id = rest.join('/')
    if (!provider) {
      throw new Error(`Invalid model ID format: ${modelId}`)
    }
    const modelRuntime = await ModelRuntime.create()
    const childIds = new Set(modelRuntime.getRegisteredProviderIds())
    for (const parentId of params.modelRegistry.getRegisteredProviderIds()) {
      if (childIds.has(parentId)) continue
      const native = params.modelRegistry.getRegisteredNativeProvider(parentId)
      if (native) {
        modelRuntime.registerNativeProvider(native)
        continue
      }
      const config = params.modelRegistry.getRegisteredProviderConfig(parentId)
      if (config) modelRuntime.registerProvider(parentId, config)
    }
    const model = modelRuntime.getModel(provider, id)
    return { model, modelRuntime }
  }
}
