# Behavior-focused tests review instructions

## Reference documentation

Read these reference documents in full before reviewing: @foundation/testing/docs/writing-tests.md for test-writing guidance, @foundation/testing/docs/testing-harness.md for dependency setup and composition, and @foundation/testing/docs/dependency-injection.md for replaceable dependency wiring. They define the terminology and standards used below. Apply their guidance to the changed tests, harnesses, and dependency-injection code. Report violations involving scenario readability, test-data ownership, reusable setup, harness composition, dependency wiring, interface shape, seam justification, or assertion boundaries—not only whether the test checks user-observable behavior.

## Scope

Review every changed test, test harness, and production dependency-injection code for behavior-focused testing one at a time.

Tests must make the scenario, actions, and expected outcome immediately understandable. Report tests that require readers to reconstruct a sequence of pending operations, waits, and releases before they can understand what behavior is being checked. Technically correct assertions are not enough: developers must be able to read and maintain the test for it to provide lasting confidence.

Do not report duplicated test setup by itself. Before recommending harness changes, check whether existing APIs or simpler test-local code can express the scenario clearly, or whether a lower-level test would protect the behavior without additional coordination machinery. Keep one canonical API for each action; do not recommend scenario-specific action helpers that wrap existing actions with waits, callbacks, releases, or assertion snapshots. When integration coverage requires observing background completion, prefer a separate observation capability that reuses existing lifecycle state or events without performing the action. Keep scenario-specific mock behavior and overrides in the tests; harnesses must not become collections of mock factories. Use fake factories to improve readability, not merely to deduplicate data construction.

Tests must exercise user-reachable behavior through a public seam and assert explicit observable outputs or externally visible effects. Report tests that instead verify implementation structure, internal collaboration, or outcomes unavailable through the public seam.

Read the relevant implementation and harnesses, including composed harnesses and test-provided overrides, to trace the test action through to the assertion. Report test doubles or harness shortcuts that bypass or implement the application behavior being checked, rather than merely controlling its dependencies, allowing the test to pass without exercising that behavior. Identify the bypassed behavior and propose the smallest change that exercises it through a public seam.

Report duplicate coverage only after identifying an existing test that exercises the same scenario and observes the same outcome. Name that test and explain why the changed test adds no distinct behavioral protection. Shared setup, shared code paths, or testing the same component do not by themselves establish duplicate coverage.

### Types of tests preferred

Assess test-layer choices using @foundation/testing/docs/writing-tests.md. Each finding must identify the scenario, explain the concrete coverage or maintenance problem, and request a justified action: delete redundant coverage, improve the existing test, or replace it through a more appropriate public seam. When recommending a different test layer, name the proposed seam, account for the documented reasons to retain unit tests, and explain the benefit relative to any additional harness code. Do not propose e2e tests or report missing e2e coverage.

### Tests that reach into implementation details

When a test cannot assert user-observable behavior through the current public seam, report exactly one of these actions:

1. **Delete the test** Use this when the behavior is already covered elsewhere or the test has low value and low removal risk.

1. **Test a lower-level public seam** Use this when one lower-level component exposes the same user-observable behavior directly without composition or new harness support.

   The finding must:
   - name the lower-level seam
   - state why it protects the same behavior
   - request moving or replacing the test, not adding duplicate coverage

1. **Extend the existing harness API** Consider this only after ruling out deletion and testing a lower-level public seam. If the lower-level test protects the same behavior and outcome, new harness API is unjustified. Name the distinct integration protection that would be lost by moving the test, and explain why existing APIs and simple test-owned dependency overrides are insufficient. Keep observations separate from actions; do not add alternative action helpers merely to hide asynchronous coordination. Readability alone does not justify additional harness machinery.

   The finding must:
   - name the harness to change
   - describe the helper
   - include a code example showing the revised test

Under **Test a lower-level public seam**, exercise one component’s public interface rather than recreating the higher-level orchestration being replaced.

Do not combine multiple options in one finding.

## Out of scope

Production correctness, security, performance, and documentation correctness are out of scope. This does not exclude assessing whether tests exercise the claimed behavior or comply with the referenced testing standards.

A harness-provided external boundary is a valid observation point. Do not require tests to call the real external service.

Anything not covered by the Scope above or the applicable testing standards in Reference documentation is out of scope. Review-specific exclusions take precedence over implementor guidance in those documents.

## Finding style

State the concrete coverage, readability, or maintainability problem and request a specific change. For coverage findings, identify the scenario and the observable result or external effect the test should protect. For readability or maintainability findings, identify the code that obscures the scenario, duplicates setup, or creates unnecessary coupling, and explain how the proposed change addresses it.

For a harness or dependency-injection anti-pattern, propose the documented solution when one is provided and reference the applicable source: @foundation/testing/docs/testing-harness.md or @foundation/testing/docs/dependency-injection.md.

There must be clear call to action, possibly with code example that would explain how the issue should be fixed.
