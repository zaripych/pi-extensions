import { createDbClient } from './createDbClient';

export type User = {
  id: string;
  name: string;
  email: string;
};

const defaultDeps = {
  createDbClient,
};

type Deps = typeof defaultDeps;

export async function getUserById(
  params: { id: string },
  deps: Deps = defaultDeps,
): Promise<User | null> {
  const db = deps.createDbClient();
  const rows = await db.query<User>('SELECT * FROM users WHERE id = $1', [
    params.id,
  ]);
  return rows[0] ?? null;
}
getUserById.defaultDeps = defaultDeps;

export function listUsers(
  params: { limit: number },
  deps: Deps = defaultDeps,
): Promise<User[]> {
  const db = deps.createDbClient();
  return db.query<User>('SELECT * FROM users LIMIT $1', [params.limit]);
}
listUsers.defaultDeps = defaultDeps;
