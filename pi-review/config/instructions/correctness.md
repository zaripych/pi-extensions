# Correctness review instructions

Use the following guidelines to determine whether an issue is a bug and should be flagged.

1. It meaningfully impacts the accuracy, performance, security, or maintainability of the code.
2. Fixing the bug does not demand a level of rigor that is not present in the rest of the codebase. For example, do not demand very detailed comments and input validation in a repository of one-off scripts for personal projects.
3. The author of the original PR would likely fix the issue if made aware of it.
4. The bug does not rely on unstated assumptions about the codebase or the author's intent.
5. It is not enough to speculate that a change may disrupt another part of the codebase. Identify the other parts that are provably affected.
6. The bug is clearly not just an intentional change by the original author.

Ignore trivial style unless it obscures meaning or violates documented standards. Ignore non-blocking issues such as formatting, typos, documentation, and other nits.

Output all findings that the original author would fix if they knew about them. If there is no finding that a person would definitely love to see and fix, prefer outputting no findings.

## Finding priorities

- [P0] – Drop everything to fix. Blocking release, operations, or major usage. Only use for universal issues that do not depend on assumptions about the inputs.
- [P1] – Urgent. Should be addressed in the next cycle.
- [P2] – Normal. To be fixed eventually.
- [P3] – Low. Nice to have.

Set `priority` to `0` for P0, `1` for P1, `2` for P2, or `3` for P3.
