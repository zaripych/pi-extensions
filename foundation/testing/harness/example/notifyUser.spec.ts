import { describe, expect, it } from 'vitest';
import { combineHarnesses } from '../combineHarnesses';
import { setupNotifyUser } from './notifyUser.harness';

const setup = combineHarnesses(setupNotifyUser);

describe('notifyUser', () => {
  it('behaves this certain way if the mailer.send regresses', async () => {
    await using harness = await setup({
      getUserById: async () => ({
        name: 'Alice',
        id: 'u1',
        email: 'alice@example.com',
      }),
      createMailer: () => ({
        send: () => {
          throw new Error('Something went wrong!');
        },
      }),
    });

    const { notifyUser } = harness;

    await expect(
      async () =>
        await notifyUser({
          userId: 'u1',
          subject: 'Hello',
          body: 'Welcome!',
        }),
    ).rejects.toThrow('Something went wrong!');
  });

  it('harnesses allows overriding any dependencies after the fact', async () => {
    await using harness = await setup();

    const { notifyUser, send, getUserById } = harness;

    /**
     * NOTE: This is not necessarily how we should be setting up mocks, it would
     * be preferred if we just overridden the `getUserById` by passing it to `setup`
     * function above, or called something like `await insertUser` to insert
     * an actual user to be tested (if we want integration-style test that encompasses
     * multiple units), although things like following are possible:
     */
    getUserById.mockImplementation(async () => ({
      name: 'Alice',
      id: 'u1',
      email: 'alice@example.com',
    }));

    const result = await notifyUser({
      userId: 'u1',
      subject: 'Hello',
      body: 'Welcome!',
    });

    expect(result).toEqual({
      user: { id: 'u1', name: 'Alice', email: 'alice@example.com' },
      sent: true,
    });
    expect(send).toHaveBeenCalledWith({
      to: 'alice@example.com',
      subject: 'Hello',
      body: 'Welcome!',
    });
  });

  it('throws when user is not found', async () => {
    await using harness = await setup();
    const { notifyUser } = harness;

    await expect(
      notifyUser({ userId: 'nonexistent', subject: 'Hi', body: 'Nope' }),
    ).rejects.toThrow('User not found: nonexistent');
  });

  it('queries the database by user id', async () => {
    await using harness = await setup();
    const { notifyUser, db } = harness;

    try {
      await notifyUser({ userId: 'u1', subject: 'Hi', body: 'Test' });
    } catch {
      //
    }

    expect(db.query).toHaveBeenCalledWith('SELECT * FROM users WHERE id = $1', [
      'u1',
    ]);
  });
});
