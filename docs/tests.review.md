# Behavior-focused tests review instructions

## Introduction

Following types of tests might exist (they might be called differently in the repository being reviewed):

- integration tests - these tests compose multiple components/dependencies together and test their combined behavior, for example, a top level API controller, with all the service dependencies injected as if we are running in production and external dependencies mocked to emulate a particular scenario, or a page rendering multiple components to virtual dom and testing how user actions affect state

- unit tests - these tests focus on a single component, such component can have no dependencies whatsoever, or only a few external dependencies which are always mocked

- e2e tests - tests that require an instance of a browser and/or actual server running in-process or out-of-process, or executing the code being tested as an external process, or network requests being made to external or internal dependencies (excluding db bound integration tests)

- db-bound tests - tests that depend on DB instance being span up before tests are run. This gets close to e2e tests but justifies its own category, because oftentimes a great db-bound test setup allows Postgres to be span up in a few seconds with fresh schema for every test worker allowing them to be run in parallel cheaply and quickly without locking, reducing the load on the team of having to mock every storage layer dependency and gain confidence in queries or indexes they use

## Scope

Review every changed test, test harness, and production dependency-injection code for behavior-focused testing one at a time.

If no changes made to harnesses, ensure that the tests do not add reusable test supporting code to the tests themselves instead of harnesses.

Tests must exercise user-reachable behavior through a public seam and assert explicit observable outputs or externally visible effects. Report tests that instead verify implementation structure, internal collaboration, or outcomes unavailable through the public seam.

Tests should not duplicate what other tests already testing.

For harness and dependency-injection changes, apply the guidance in @foundation/testing/docs/testing-harness.md and @foundation/testing/docs/dependency-injection.md. Use the working example referenced by the harness documentation as the repository pattern. Report a finding only when the changed design requires contextual judgment about the behavioral seam, implementation coupling, dependency responsibility, interface shape, or whether a seam is justified.

### Types of tests preferred

Integration tests and db-bound integration tests for layers as high as possible and as close as possible to the actual users, without going into e2e category - expected to be at 80-99%. The lower level component tests are expected to be covered by higher level component tests that use them in their integration tests.

Single component tests only for high complexity or high risk components - expected to be at 0-10%. Single component tests are justified if pulling such components tests up to an integration test requires significant amount of test-harness code for capability of testing user-observable behavior.

e2e tests - at 1-10% for critical functionality.

### Tests that reach into implementation details

When a test cannot assert user-observable behavior through the current public seam, report exactly one of these actions:

1. **Delete the test**
   Use this when the behavior is already covered elsewhere or the test has low value and low removal risk.

1. **Add a harness helper**
   Use this when observing the behavior requires composing the system under test with another component or exposing an external effect through its harness. Only choose this when the helper adds no more than 5% of the changed production LOC.

   The finding must:
   - name the harness to change
   - describe the helper
   - include a code example showing the revised test

1. **Test a lower-level public seam**
   Use this when one lower-level component exposes the same user-observable behavior directly without composition or new harness support.

   The finding must:
   - name the lower-level seam
   - state why it protects the same behavior
   - request moving or replacing the test, not adding duplicate coverage

Do not propose composing multiple components under option 3. That is option 2.
Do not combine multiple options in one finding.

## Out of scope

Correctness, security, performance, documentation correctness are out of scope.

A harness-provided external boundary is a valid observation point. Do not require tests to call the real external service.

Anything else not explicitly mentioned in scope section above or as an anti-pattern in @foundation/testing/docs/testing-harness.md and @foundation/testing/docs/dependency-injection.md.

## Finding style

State the user-reachable behavior the test fails to protect and request an assertion through the applicable public seam.

For a harness or dependency-injection anti-pattern, propose the documented solution when one is provided and reference the applicable source: @foundation/testing/docs/testing-harness.md or @foundation/testing/docs/dependency-injection.md.

There must be clear call to action, possibly with code example that would explain how the issue should be fixed.
