---
name: review-author
description: |
  Create source-driven pi-review instruction files from user-provided review rules and anti-pattern documentation. Triggers: explicit human invocation through /review-author or /skill:review-author.
disable-model-invocation: true
---

# Author review instructions

Create a focused `*.review.md` rubric for pi-review.

## Required references

Before drafting, read these files completely:

- `../../config/review-prompt.md` for the immutable review contract
- `../../review-output/reviewOutputSchema.ts` for the output schema
- [review-instructions.template.md](review-instructions.template.md) as the starting shape

## Guardrail

Exclude a deterministic check when an off-the-shelf rule from a well-known linting or validation tool can enforce it, or when the repository already contains an applicable lint rule, script, test, type check, schema check, or AST analysis. Search the repository for project-specific enforcement before classifying the check, then tell the user which available mechanism should replace it.

Do not exclude a check solely because custom programmatic enforcement could be created. If enforcing it would require a new repository-specific rule, script, test, schema, or AST analysis, keep it eligible for the rubric.

## Workflow

1. Read every instruction or anti-pattern source supplied by the user. Resolve repository paths from the repository root.
2. Classify each candidate rule as judgment-based, enforceable by an off-the-shelf rule or existing repository mechanism, or deterministic but lacking such enforcement. Exclude only the second category under the guardrail.
3. Determine whether the remaining sources define the review scope, qualifying findings, exclusions, severity, and any required finding or summary style well enough to produce a precise rubric.
4. If decisions are missing or ambiguous, ask targeted questions before drafting. Probe edge cases and conflicting rules. Use the `grill-me` skill when it is available and useful.
5. Derive rules strictly from the supplied sources and the user's answers. Do not invent anti-patterns, categories, severities, or policy choices.
6. Draft from the template. Delete sections that the rubric does not need. Keep the result concise and avoid repeating general rules from `review-prompt.md` or the output schema.
7. Refer to source documents inside the repository as `@relative/path`. Do not copy their full contents into the rubric when a precise reference is sufficient.
8. Run a compatibility pass against `review-prompt.md` and `reviewOutputSchema.ts`. The rubric must not contradict the review contract, required fields, field constraints, diff-local finding rules, tool usage, or submission behavior. Ask the user to resolve any conflict rather than silently choosing.
9. Write the approved result to `docs/<name>.review.md` unless the user supplies another path. Ask for `<name>` when it cannot be derived without guessing.
10. Re-read the written file and verify that every substantive rule is allowed by the guardrail and traceable to a supplied source or an explicit user answer.

Do not write the file until the input is sufficient for a high-quality rubric.

## Completion

Finish when the instruction file exists at the agreed path and passes the compatibility and traceability checks. Report only the path and any unresolved limitation the user explicitly accepted.
