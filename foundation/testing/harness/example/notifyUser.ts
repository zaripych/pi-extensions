import { createMailer } from './createMailer';
import { getUserById, type User } from './userRepository';

const defaultDeps = {
  getUserById,
  createMailer,
};

type Deps = typeof defaultDeps;

export type NotificationResult = {
  user: User;
  sent: boolean;
};

export async function notifyUser(
  params: { userId: string; subject: string; body: string },
  deps: Deps = defaultDeps,
): Promise<NotificationResult> {
  const user = await deps.getUserById({ id: params.userId });
  if (!user) {
    throw new Error(`User not found: ${params.userId}`);
  }

  await deps
    .createMailer()
    .send({ to: user.email, subject: params.subject, body: params.body });

  return { user, sent: true };
}
notifyUser.defaultDeps = defaultDeps;
