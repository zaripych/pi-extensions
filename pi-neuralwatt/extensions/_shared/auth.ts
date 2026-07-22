const PROVIDER_ID = 'neuralwatt'

interface ApiKeyProvider {
  getApiKeyForProvider(provider: string): Promise<string | undefined>
}

export async function getNeuralwattApiKey(
  modelRegistry: ApiKeyProvider
): Promise<string | undefined> {
  const key = await modelRegistry.getApiKeyForProvider(PROVIDER_ID)
  return key ?? process.env.NEURALWATT_API_KEY
}
