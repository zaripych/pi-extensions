const TIMEOUT_MS = 15_000

export async function fetchJson(params: {
  url: string
  headers: Record<string, string>
}): Promise<unknown> {
  const response = await fetch(params.url, {
    method: 'GET',
    headers: params.headers,
    redirect: 'error',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText} ${params.url}`)
  }
  return JSON.parse(await response.text())
}
