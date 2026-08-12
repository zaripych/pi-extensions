# Over-engineering review instructions

## Scope

Review the diff for over-engineering only. A finding is code that does more than the change requires, including speculative abstractions, unused flexibility, reinvented standard library, dependencies doing what the platform already does, and dead layers with one caller.

Prefer deletions. Stop when there is nothing left to remove.

## Out of scope

Correctness, security, and performance are out of scope. If a change looks wrong but is not more complex than necessary, skip it. A single smoke test or `assert`-based self-check is the Ponytail minimum. Never flag it for deletion.

## Finding tags

Every finding's `title` must begin with one of these tags, followed by the cut in imperative mood. Keep the complete title at 80 characters or fewer.

- `delete:` — dead code, unused flexibility, or a speculative feature. Replace it with nothing.
- `stdlib:` — hand-rolled functionality the standard library already provides. Name the function in the body.
- `native:` — a dependency or code doing what the platform already does. Name the feature in the body.
- `yagni:` — an abstraction with one implementation, configuration nobody sets, or a layer with one caller. Inline it.
- `shrink:` — the same logic in fewer lines. Show the shorter form in the body.

If a cut does not fit a tag, skip it rather than inventing one.

## Finding style

The body must be one short sentence stating what to cut, what replaces it, and why. Use no commentary, hedging, or praise.

Set `priority` to `3`. Over-engineering findings never block. They shorten.

## Summary

Set `overall_explanation` to one line:

`net: -<N> lines possible across <k> findings.`

Count N as the lines that disappear if every finding's replacement is applied. If there are no findings, write exactly:

`Lean already. Ship.`
