/** Thrown when live provider evidence describes a billing cycle newer than
 * the captured payment history — a forced capture refresh can resolve it. */
export class StaleBillingCaptureError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'StaleBillingCaptureError'
  }
}
