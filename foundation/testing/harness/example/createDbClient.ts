export type DbClient = {
  query: <T>(sql: string, params: unknown[]) => Promise<T[]>
}

export function createDbClient(): DbClient {
  return {
    query: () =>
      Promise.reject(
        new Error(
          `Real DB not available (would connect to "postgres://localhost:5432/app"`
        )
      ),
  }
}
