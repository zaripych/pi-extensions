export class UnreachableError extends Error {
  constructor(value: never) {
    super(`Unreachable value: ${String(value)}`)
    this.name = 'UnreachableError'
  }
}
