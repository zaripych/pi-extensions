import { vi } from 'vitest';
import { configureHarnesses } from '../configureHarnesses';
import type { Mailer } from './createMailer';

const setupTestDeps = () => {
  const send: Mailer['send'] = vi.fn(async () => {});
  return {
    send,
  };
};

export const setupCreateMailer = configureHarnesses(setupTestDeps, (deps) => {
  const createMailer = vi.fn((): Mailer => ({ send: deps.send }));
  return {
    createMailer,
  };
});
