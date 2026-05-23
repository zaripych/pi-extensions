export type Mailer = {
  send: (params: {
    to: string;
    subject: string;
    body: string;
  }) => Promise<void>;
};

export function createMailer(): Mailer {
  return {
    send: () =>
      Promise.reject(new Error('Real mailer not available in example')),
  };
}
