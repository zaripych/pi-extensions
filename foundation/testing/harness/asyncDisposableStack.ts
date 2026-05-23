/**
 * Minimal AsyncDisposableStack implementation.
 *
 * Node 22 exposes `Symbol.asyncDispose` but not the `AsyncDisposableStack`
 * class. This covers the subset we need: `defer` to register teardown
 * callbacks, and `[Symbol.asyncDispose]` to run them in reverse order.
 */
type DeferredCallback = () => unknown

export class AsyncDisposableStack {
  private readonly callbacks: DeferredCallback[] = []
  private disposed = false

  defer(fn: DeferredCallback): void {
    if (this.disposed) {
      throw new Error('AsyncDisposableStack already disposed')
    }
    this.callbacks.push(fn)
  }

  async [Symbol.asyncDispose](): Promise<void> {
    if (this.disposed) return
    this.disposed = true

    const errors: unknown[] = []
    for (let i = this.callbacks.length - 1; i >= 0; i--) {
      try {
        await this.callbacks[i]?.()
      } catch (err) {
        errors.push(err)
      }
    }

    if (errors.length === 1) throw errors[0]
    if (errors.length > 1) {
      throw new AggregateError(errors, 'Multiple errors during disposal')
    }
  }
}
