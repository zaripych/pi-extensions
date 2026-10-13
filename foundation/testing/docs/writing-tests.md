# Writing Tests

The following types of tests may exist, regardless of how the repository names them:

- **Integration tests:** Compose multiple components with their real implementations and test their combined behavior. External dependencies are mocked to emulate the scenario.
- **Unit tests:** Focus on a single component with no dependencies or a few external dependencies that are mocked.
- **e2e tests:** Require a browser, an actual server running in-process or out-of-process, execution of the code under test as an external process, or real network requests. Database access in db-bound tests is excluded from this category.
- **db-bound tests:** Use a real database instance started for testing. They exercise database behavior without mocking the storage layer. A fresh schema for each test worker allows these tests to run independently and in parallel.

## Types of tests preferred

Prefer integration tests and db-bound tests at the highest layer that can exercise user-observable behavior without requiring an e2e test. Compose real components and replace external dependencies with test doubles, except the database in db-bound tests. Let these tests cover the lower-level components they exercise. Use unit tests for high-complexity or high-risk behavior, or when exercising the same behavior through an integration test would require significant additional harness code.

Do not create e2e tests unless the user explicitly requests them. When failure could block a core user workflow or cause significant business harm, and integration tests leave an external contract or runtime boundary unverified because they replace it with mocks, flag that confidence gap to the user. Explain the failure scenario, what the integration tests cannot establish, and how an e2e test would address it. Recommend e2e coverage only when it would verify that missing boundary rather than duplicate integration coverage.

Before adding a unit test, check whether an integration test already exercises the same scenario and observes the same outcome. Do not add a separate test merely to verify internal delivery or routing that this integration test already covers. Additional tests should protect a distinct behavior or failure case.

Keep tests flat. Do not add a top-level `describe` that repeats information already conveyed by the file name. Use `describe` only when it adds new information about the tests it groups.

## Test data

Fake factories create structurally valid test data, using `faker` for placeholder values and accepting overrides for values relevant to the test. Colocate domain fake factories with the module that owns the data in `<module>.fakes.ts`. Reuse existing factories rather than duplicating inline fixtures. Create test data in the block that uses it: data used to configure harness dependencies belongs in setup, while function parameters usually belong in the actions block. Explicitly supply any values whose particular contents matter to the behavior being checked. Assertions should use that test-owned data, not assume particular factory defaults.

For functions whose parameters object has more than three required properties, a fake factory may create the parameters. Colocate this parameter fake factory with the harness covering the function. Supply overrides for values relevant to the test, leaving the remaining properties to the factory.

For example, `placeOrder.fakes.ts` sits alongside `placeOrder.harness.ts`:

```ts
// placeOrder.fakes.ts
import { faker } from '@faker-js/faker'
import { placeOrder } from './placeOrder'

type PlaceOrderParams = Parameters<typeof placeOrder>[0]

export function fakePlaceOrderParams(
  params: Partial<PlaceOrderParams> = {}
): PlaceOrderParams {
  return {
    customerId: faker.string.uuid(),
    productId: faker.string.uuid(),
    quantity: faker.number.int({ min: 1, max: 10 }),
    deliveryAddress: faker.location.streetAddress(),
    ...params,
  }
}
```

A test creates its parameters in the block that uses them, usually the actions block. With `placeOrder` obtained from the harness:

```ts
const params = fakePlaceOrderParams({ quantity: 2 })
await placeOrder(params)
```

## Combining harnesses in tests

Define `const setup = combineHarnesses(...)` at module scope to compose the dependency tree. Keep each test focused on the behavior named in `it(...)`, with three blocks separated by blank lines:

1. **Setup:** Create test data needed to configure harness dependencies, acquire the harness with `await using harness = await setup(...)`, and destructure the functions and dependencies the test uses. Keep these together without blank lines between them.
2. **Actions:** Create function parameters here when they are used by the actions, and make one or more calls that exercise the behavior being tested, with no assertions between them.
3. **Assertions:** Put all assertions at the end. Check only the behavior this test intends to verify; do not repeat general checks shared across tests.

Before writing a test, inspect the harness and all harnesses it composes to understand the API available through `combineHarnesses`. Read the implementations of functions relevant to the test's actions, not just their signatures.

Reuse the existing API where it fits. If it cannot express the required scenario, improve that API rather than adding another way to perform the same action. Add only capabilities needed by the current scenario, following the harness and dependency-injection principles.

Harness APIs should support integration tests through public interfaces, not provide shortcuts that bypass composed components for unit testing or side-effect lookups.

```ts
// notifyUser.test.ts
import { combineHarnesses } from '../combineHarnesses'
import { setupNotifyUser } from './notifyUser.harness'
import { fakeUser } from './userRepository.fakes'

const setup = combineHarnesses(setupNotifyUser)

it('sends email to the user', async () => {
  const user = fakeUser()
  await using harness = await setup({
    getUserById: async () => user,
  })
  const { notifyUser, send } = harness

  await notifyUser({ userId: user.id, subject: 'Hi', body: 'Hello' })

  expect(send).toHaveBeenCalledWith({
    to: user.email,
    subject: 'Hi',
    body: 'Hello',
  })
})
```

- Override any dependency at any depth via `setup({ ... })`.
- `await using` ensures teardown runs automatically.
- All returned functions are `Mock` — use `.mockImplementation()` when needed.

## Asynchronous tests

Do not use fixed sleeps or sleep-based polling in non-e2e tests. Await the action under test directly when it represents completion. For background operations, event-driven waiting is allowed: await an event from a stream or subscription that satisfies an explicit criterion. Use timeouts only to bound failure, not to delay execution. Sleep-based observation is allowed only in e2e tests involving an external process, service, or browser.

Use the `await using` mechanism provided by test harnesses for automatic cleanup. Harnesses must dispose of the resources and settle the running operations they own, including when an action or assertion fails, without requiring manual teardown in individual tests.

## Assertions

Assert results or externally visible effects through the public interface being tested. Calls to harness-provided external dependencies are valid observations; the real external service need not run. Do not substitute private state, internal event shapes, or intermediate function calls for the behavior the test intends to protect.
