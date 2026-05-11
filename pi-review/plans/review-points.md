## Checklist Results

| Criterion | Verdict | Notes |
|---|---:|---|
| Accuracy | **Concern** | The pi CLI flags and extension mechanics mostly check out. `--system-prompt`, `--no-*`, `-e`, `--tools`, JSON mode, terminating tool results, `pi.sendMessage`, and first-extension-tool-wins are real. Main accuracy issue: `extraArgs` can contradict the “internal tools are always added” invariant if appended after the final `--tools`. Also default `systemPrompt: ~/.pi/agent/review-prompt.md` conflicts with `PI_CODING_AGENT_DIR` unless resolved before passing to pi. |
| Completeness | **Concern** | Very complete plan, but missing explicit subprocess arg ordering, single-active-review behavior, dash-starting custom prompt handling, and robust fallback parsing from assistant text/JSON. |
| Quality | **Concern** | Architecture is clean: config, prompts, subprocess, parsing, rendering, command wiring are separated and testable. The weakest quality point is the loose `finish-review` schema and unclear escape-hatch semantics. |
| Risks and Edge Cases | **Concern** | Good git injection hardening. Security posture is honest about not being a sandbox. Remaining risk: built-in `read`/`grep`/`find`/`ls` are read-only but not repo-confined, and `extraArgs`/configured extensions can intentionally punch holes through isolation. |
| Ordering and Sequencing | **Pass with concerns** | Phases are sensible. Phase 1 should also lock down subprocess arg precedence because later phases/tests depend on it. |

## Recommendations

1. **Resolve the `extraArgs` contradiction before implementation.**  
   The plan says internal tools are always appended to the final `--tools`, but also says `extraArgs` are appended intentionally. Pi’s parser keeps the last `--tools` value, so if `extraArgs` comes after the canonical `--tools`, users can drop `reviewer-git`/`finish-review` and break structured output. Pick one:
   - Put `extraArgs` **before** invariant flags/final `--tools`; or
   - Treat `extraArgs` as full override and weaken/remove the “internal tools are always added” invariant and related tests.

2. **Make `systemPrompt` path resolution unambiguous.**  
   The default config example uses `~/.pi/agent/review-prompt.md`, but the stated default is `${getAgentDir()}/review-prompt.md`. With `PI_CODING_AGENT_DIR`, those differ. Also `--system-prompt` only reads a file if the argument resolves to an existing path. Add tests for:
   - default agent dir,
   - `PI_CODING_AGENT_DIR`,
   - `~` expansion,
   - missing prompt file failing clearly instead of passing a literal path as the prompt.

3. **Add a JSON/text fallback parser before the raw-text fallback.**  
   If the reviewer ignores `finish-review` and emits Codex-style JSON, the current fallback turns it into `findings: []`, losing real findings. Parser order should include:
   - successful `finish-review` tool result/details,
   - assistant tool call args if schema-valid,
   - strict JSON parse from last assistant text,
   - substring `{...}` JSON parse,
   - only then raw-text wrapper.

4. **Tighten the `finish-review` schema.**  
   Use integer/ranged schema constraints where possible:
   - `priority`: integer `0..3`
   - `confidence_score` and `overall_confidence_score`: number `0..1`
   - line `start`/`end`: positive integers, with runtime validation that `end >= start`
   Type.Number is too loose for code locations and priorities.

5. **Define concurrent `/review` behavior.**  
   “Store child process reference at extension scope” is not enough. Decide whether a second `/review`:
   - rejects while one is active,
   - cancels/replaces the active review,
   - or queues.  
   Without this, the child reference/status cleanup can be overwritten.

6. **Do not rely on command-level cancellation unless verified.**  
   `ctx.signal` is usually undefined in extension commands. `session_shutdown` cleanup is real; Escape-to-cancel for a long-running command is not established by the docs. Either implement only shutdown cleanup, or prove command cancellation works and test it.

7. **Protect custom prompt CLI parsing.**  
   `/review <text>` maps to Custom target, and the plan says Custom is verbatim user text. If the subprocess receives a task prompt that starts with `--`, pi parses it as a flag. Prefix custom prompts with stable text like `Custom review instructions:\n...`, or send the prompt through stdin.

8. **Document read-only vs repo-confined accurately.**  
   Built-in read/search/list tools are read-only, but built-in path resolution allows absolute paths and `~`. That is acceptable under the non-security-boundary caveat, but README/config comments should say “read-only, not repo-confined” unless you build custom repo-confined tools.

9. **Add tests for arg precedence, not just arg presence.**  
   `features/subprocess/args.test.ts` should cover duplicate `--tools`, duplicate `--system-prompt`, extra `-e`, and `extraArgs` ordering. This catches the biggest implementation footgun.

10. **Add package installability checks.**  
   The plan should mention package `files`/exports enough to ensure `features/subprocess/review-tools-extension.ts`, `review-prompt.md`, and defaults are included when installed via npm/git.

## Security Assessment

- **Secrets and credentials:** No hardcoded secrets in the plan. Good requirement to not pass config contents into output.
- **Input validation:** Strong git ref/path validation planned. Needs `extraArgs` precedence decision and custom prompt CLI handling.
- **Dependency risk:** `yaml` is reasonable as a runtime dependency; keep it in `dependencies`.
- **Existing controls:** Default tool set excludes `bash`, `write`, and `edit`; good. Escape hatches are documented, but should be made explicit as isolation overrides.
- **Infrastructure / CI/CD:** No relevant infra or CI/CD changes in this plan.

## Overall Assessment

**Needs minor revisions** before execution.

The design is solid and well aligned with pi’s extension model. The blockers are not architectural; they are sharp edge cases around subprocess arg precedence, path resolution, parser fallback, and cancellation/concurrency semantics.

## Path Forward

1. First revise the plan around subprocess arg ordering, `extraArgs`, and `systemPrompt` resolution.
2. Add the parser/schema hardening requirements.
3. Add concurrency/cancellation behavior.
4. Add tests for those edge cases in Phase 1/4.
5. Then execute the phases as written.