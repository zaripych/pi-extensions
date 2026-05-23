import { vi } from 'vitest';
import type { DbClient } from './createDbClient';

export function setupDbClient() {
  const db: DbClient = {
    query: vi.fn(async () => []),
  };

  return {
    db,
    createDbClient: () => db,
  };
}
