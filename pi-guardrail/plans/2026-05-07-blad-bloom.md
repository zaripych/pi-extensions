# pi-guardrail implementation plan

## Goal

Build `pi-guardrail`, a policy-only pi extension that steers model tool use into
`hand-hold` or `read-only` modes. It complements `pi-sandbox`: guardrail decides
whether the model may attempt a tool/command; sandbox enforces
filesystem/network/resource access if the attempt runs.

Human commands are outside guardrail policy. The mode is for LLM tool use only.

`read-only` is a conservative LLM steering mode, not a filesystem
write-prevention guarantee. Its default policy should avoid obvious
project-mutating commands and known write-producing command forms, but it does
not prove that an arbitrary shell command cannot write under every flag,
expansion, or path choice. Path-level decisions such as allowing scratch writes
under `/tmp/*` belong to `pi-sandbox` or to a future path-aware policy
mechanism, not to the initial prefix classifier.

## Non-goals

- `pi-guardrail` is not a sandbox or shell security boundary and does not
  attempt to prove command safety under all shell expansion behavior, including
  environment variable expansion, command substitution, aliases, functions, or
  glob expansion.
- `pi-guardrail` is a policy and pacing layer for common model tool-use
  mistakes. Filesystem, network, and process isolation remain the responsibility
  of `pi-sandbox`.
- Bash classification may reject unsupported shell constructs as `bash:unknown`,
  but hacker-proof shell analysis is intentionally out of scope.
- Initial bash classification is not path-aware. It does not distinguish writing
  `/tmp/out.log` from overwriting an existing project file. Command forms with
  known write-producing flags should therefore be excluded from `bash:read` by
  default unless a future classifier can evaluate target paths against sandbox
  or policy rules.
- `pi-guardrail` does not aggressively poll Pi's tool registry or proactively
  disable tools registered later by other extensions. Late tools are handled
  lazily by `tool_call` enforcement so guardrail does not fight extension-owned
  runtime tool management.

## Resolved decisions

### Package and user interface

- Package name: `pi-guardrail`.
- Global-only policy file: `~/.pi/agent/guardrail.yaml`.
- If the policy file does not exist, create it once from the shipped commented
  default.
- After creation, YAML is the single source of truth. Do not merge hidden
  internal defaults into an existing YAML file.
- The shipped default YAML must include all default policy state, including bash
  classification groups. App source may contain the default YAML text, but must
  not contain separate hidden bash default groups that are merged at load time.
- Add `/guardrail reset-to-default` to overwrite `~/.pi/agent/guardrail.yaml`
  with the shipped default after confirmation.
- Runtime default: loaded extension starts in `hand-hold` mode.
- CLI flag:
  - `--guardrail read-only`
  - `--guardrail hand-hold`
  - `--guardrail off`
- `--guardrail` is a string pi flag; validate the value manually. Only
  `read-only`, `hand-hold`, and `off` are valid. Invalid values fail safe and
  report a clear status/notification.
- Slash command:
  - `/guardrail`
  - `/guardrail status`
  - `/guardrail doctor`
  - `/guardrail off`
  - `/guardrail read-only`
  - `/guardrail hand-hold`
  - `/guardrail reload`
  - `/guardrail reset-to-default`
  - `/guardrail discover <cli>`
- Optional aliases:
  - `/read-only` -> `/guardrail read-only`
  - `/hand-hold` -> `/guardrail hand-hold`

### Config failure behavior

- If startup or reload cannot read/parse/validate `guardrail.yaml`, deny
  everything for the model:
  - `pi.setActiveTools([])`
  - `tool_call` blocks every model tool call
  - status shows config error
- Validation has two severities:
  - fatal errors for unreadable YAML, parse failures, schema/type errors,
    invalid modes, invalid capability names, and invalid bash group shape
  - non-fatal bash policy diagnostics for rejected bash command entries that can
    be excluded from normal classification while preserving the rest of the
    policy
- Non-fatal bash policy diagnostics do not enter deny-all config-error mode.
  Startup/reload continues with the invalid bash entries removed from the normal
  classifier, retained as deny-only safety prefixes, and emits a visible warning
  that names the rejected entries and how to inspect them with
  `/guardrail doctor`.
- Human commands remain available:
  - `/guardrail status`
  - `/guardrail doctor`
  - `/guardrail reload`
  - `/guardrail reset-to-default`
  - `/guardrail off`
- `/guardrail off` is allowed after config failure because it is explicit human
  action.
- `/guardrail off` restores the active tool list that existed before guardrail
  first activated, filtered to currently registered tools.

### Policy model

Modes use three action lists:

```yaml
modes:
  read-only:
    allow: []
    ask: []
    deny: []

  hand-hold:
    allow: []
    ask: []
    deny: []
```

Mode validation:

- `allow`, `ask`, and `deny` must be disjoint inside each mode.
- Unmentioned capabilities deny by default.
- `deny > ask > allow` for compound bash evaluation.
- `read-only` means the model may use configured inspection tools and bash
  commands classified as `bash:read`; it does not guarantee that no filesystem
  write can occur. The default policy still treats known write-producing forms
  as non-read because the mode is intended to prevent routine model-initiated
  project mutation.
- Bare `bash` is invalid.
- Valid bash capabilities:
  - `bash:read`
  - `bash:write`
  - `bash:dangerous`
- Any other `bash:*` is invalid.
- `bash:unknown` is reserved and must not appear in YAML `allow`, `ask`, or
  `deny` lists. Unknown bash commands are handled by built-in mode behavior:
  deny in `read-only`, ask in `hand-hold`. This prevents invalid classifier
  entries from becoming less restrictive through fallback to a configurable
  unknown bucket.
- Non-bash tool names may be configured before that tool exists. This supports
  tools registered by other extensions.

Default policy content should be safe and visible in the generated YAML. This
full generated default must include both mode capability lists and the bash
classification groups those modes reference:

```yaml
modes:
  read-only:
    allow:
      - read
      - grep
      - find
      - ls
      - bash:read
    ask: []
    deny:
      - write
      - edit
      - bash:write
      - bash:dangerous

  hand-hold:
    allow:
      - read
      - grep
      - find
      - ls
      - bash:read
    ask:
      - write
      - edit
      - bash:write
      - bash:dangerous
    deny: []

bash:
  read:
    - name: defaults
      description: Basic local inspection commands: pwd, cat, head, tail, wc, file, stat, git status/diff/log/show/rev-parse, and common --version checks.
      commands:
        - pwd
        - cat
        - head
        - tail
        - wc
        - file
        - stat
        - git --version
        - node --version
        - npm --version
        - pnpm --version
        - yarn --version
        - python --version
        - python3 --version
        - uv --version
        - git status
        - command: git diff
          except:
            - --output
        - command: git log
          except:
            - --output
        - command: git show
          except:
            - --output
        - git rev-parse

  write:
    - name: package-managers
      description: Package-manager commands that modify dependencies or lockfiles.
      commands:
        - npm install
        - npm uninstall
        - npm update
        - pnpm install
        - pnpm add
        - pnpm remove
        - pnpm update
        - yarn install
        - yarn add
        - yarn remove
        - uv add
        - uv remove
        - uv sync

  dangerous:
    - name: destructive-shell
      description: Shell/system commands that delete files, change ownership/permissions, kill processes, or affect disks/system state.
      commands:
        - rm
        - rmdir
        - sudo
        - chmod
        - chown
        - chgrp
        - kill
        - pkill
        - killall
        - shutdown
        - reboot
        - dd
        - mkfs
        - mount
        - umount
```

### Bash policy schema

Bash policy entries are groups only. No mixed bare strings at the
`read`/`write`/`dangerous` list level.

Inside a group's `commands`, entries may be either:

- a string command prefix
- an object with `command` and optional `except`

```yaml
bash:
  read:
    - name: defaults
      description: Basic local inspection commands: pwd, cat, head, tail, wc, file, stat, git status/diff/log/show/rev-parse, and common --version checks.
      commands:
        - pwd
        - cat
        - head
        - tail
        - wc
        - file
        - stat
        - git --version
        - node --version
        - npm --version
        - pnpm --version
        - yarn --version
        - python --version
        - python3 --version
        - uv --version
        - git status
        - command: git diff
          except:
            - --output
        - command: git log
          except:
            - --output
        - command: git show
          except:
            - --output
        - git rev-parse

  write:
    - name: package-managers
      description: Package-manager commands that modify dependencies or lockfiles.
      commands:
        - npm install
        - npm uninstall
        - npm update
        - pnpm install
        - pnpm add
        - pnpm remove
        - pnpm update
        - yarn install
        - yarn add
        - yarn remove
        - uv add
        - uv remove
        - uv sync

  dangerous:
    - name: destructive-shell
      description: Shell/system commands that delete files, change ownership/permissions, kill processes, or affect disks/system state.
      commands:
        - rm
        - rmdir
        - sudo
        - chmod
        - chown
        - chgrp
        - kill
        - pkill
        - killall
        - shutdown
        - reboot
        - dd
        - mkfs
        - mount
        - umount
```

Matching is prefix-based, like `assist`:

- policy entry matches if `command === entry`
- or `command.startsWith(entry + " ")`
- for object entries, use the `command` field as the entry
- when an object entry has `except`, classify it as non-matching if any parsed
  static argument after the command prefix is exactly the excepted option or
  starts with `except + "="`

Cross-category overlaps are invalid:

- Normalize every bash command entry to its effective prefix, using the
  `command` field for object entries.
- If two effective prefixes are equal, or one is a prefix parent of the other by
  the same matching rule, and they belong to different categories (`read`,
  `write`, `dangerous`), reject both entries from the effective bash classifier
  as one conflict group.
- Allow same-category overlaps, but report them as warnings if useful because
  they are redundant or rely on longest-prefix matching only for same-category
  specificity.
- Rejected prefixes are removed from normal read/write/dangerous classification
  but retained in a deny-only safety prefix list checked before normal
  classification. This keeps non-fatal diagnostics fail-safe: an invalid
  rejected prefix must not become less restrictive by falling through to
  ordinary unknown handling.
- After validation removes rejected entries from the normal classifier,
  classification must use deterministic longest-prefix matching. Longest-prefix
  matching is for deterministic same-category behavior, not for resolving
  cross-category conflicts.
- Rejected bash entries must not feed system prompt guidance.

Example rejected policy:

```yaml
bash:
  read:
    - name: custom-git
      description: Broad git family.
      commands:
        - git
  dangerous:
    - name: destructive-git
      description: Destructive git operations.
      commands:
        - git reset --hard
```

Expected diagnostic:

```text
pi-guardrail: invalid bash policy entries ignored

Conflict:
  bash.read[custom-git].commands[0]: git
  bash.dangerous[destructive-git].commands[0]: git reset --hard

Reason:
  "git" overlaps "git reset --hard" across categories. Cross-category prefix overlaps are not allowed because classification would be ambiguous.

Fix:
  Remove the broad entry, or replace it with narrower read-oriented entries such as git status, git log, git show, and git rev-parse, with exceptions for known write-producing flags where needed.
```

If a command matches a rejected deny-only safety prefix, deny it before normal
classification. If no read/write/dangerous rule matches after applying `except`,
classify the command as `bash:unknown`.

Keep the default read list conservatively curated like `assist`. Do not classify
broad git command families such as `git branch` or `git remote` as `bash:read`
by default; they include mutating forms and remain `bash:unknown` unless the
policy later adds explicitly narrowed read-oriented forms.

Do not try to close every possible shell angle in the prefix classifier. The
intended line is: exclude known write-producing forms that are visible in parsed
static command parts, classify unsupported or ambiguous forms as `bash:unknown`,
and leave real filesystem/path enforcement to `pi-sandbox`.

`bash.read/write/dangerous[*].description` feeds system prompt guidance. Do not
dump large command lists into the prompt.

### Policy diagnostics and doctor

Policy load returns both an effective policy and diagnostics:

- fatal diagnostics: no effective policy is produced; guardrail enters
  config-error deny-all mode
- non-fatal diagnostics: an effective policy is produced after rejected bash
  entries are removed from normal classification and retained as deny-only
  safety prefixes

At startup and `/guardrail reload`, if non-fatal diagnostics exist:

- emit one concise visible warning/status notification
- include the count of rejected bash entries and conflict groups
- name `/guardrail doctor` as the command for the full report
- keep running with the effective policy

`/guardrail doctor` re-runs the same schema validation, bash overlap validation,
and effective-policy construction used by startup/reload, but through a
non-mutating config read path. Do not implement a second validator for doctor.
Keep the filesystem behavior split:

- startup and `/guardrail reload` use the load path that ensures
  `~/.pi/agent/guardrail.yaml` exists by creating it from the shipped default
  when missing
- `/guardrail doctor` reads the current file if present; if it is missing,
  report that startup/reload would create the default, but do not create or
  overwrite anything

Doctor output:

- reports `ok`, `warning`, and `error` diagnostics
- shows exact YAML paths for rejected bash entries, including category, group
  name, command index, and command prefix
- explains why each cross-category overlap was rejected
- shows whether guardrail would run normally, run with rejected entries ignored,
  or enter config-error deny-all mode
- never modifies config

If a package-level CLI command is added later,
`pi-guardrail doctor --config <path>` and `pi-guardrail doctor --json` should
use this same validator. The slash command is required for the initial
implementation; a package CLI is optional.

### Bash classification

- Adapt `assist` shell parsing/classification code from `~/Projects/assist`,
  especially `splitCompound` behavior. Preserve source/license attribution in
  comments or docs for copied or closely adapted code.
- Use `shell-quote` rather than writing a simpler parser.
- Apply `except` checks only to parsed static command parts. Do not expand the
  classifier scope into shell-hardening; shell expansion bypass resistance is a
  non-goal for `pi-guardrail`.
- Reject or classify unsafe redirects as `bash:unknown`, matching `assist`
  behavior.
- Add this comment in the redirect handling path:

```ts
// Redirect handling intentionally mirrors assist's cliHook behavior:
// unsafe file redirects make an otherwise read-looking command non-read-only.
```

Classifier output:

- `bash:read`
- `bash:write`
- `bash:dangerous`
- `bash:unknown`

Mode action lookup for `bash:unknown` is built in rather than YAML-driven:

- `read-only`: deny
- `hand-hold`: ask

Configuring `bash:unknown` in any mode action list is a validation error.

Compound command rules:

1. Split command into simple parts.
2. Classify each part.
3. Map each part to the active mode action.
4. If any part maps to `deny`, block the whole command.
5. Else if exactly one part maps to `ask`, prompt for that part; if approved,
   run the whole command.
6. Else if multiple parts map to `ask`, prompt once for the whole compound; only
   allow-once is offered.
7. Else all parts are allowed; run.

If splitting fails, classify the whole command as `bash:unknown` and do not
offer per-session exact grants.

### Ask prompts and session grants

For non-bash tools in `ask`, prompt options:

- Abort
- Allow once
- Allow this tool for session

If `ctx.hasUI` is false, use the same conservative behavior as `pi-sandbox`:
treat prompt-required actions as aborted and block with a clear reason. Do not
auto-approve in non-interactive/no-UI contexts.

For simple bash commands or compounds with exactly one risky part:

- Abort
- Allow once
- Allow exact command for session
- Allow `bash:<classification>` for session, only when classification is one of
  `bash:read`, `bash:write`, or `bash:dangerous`

For `bash:unknown`, do not offer a classification-wide session grant. Unknown
commands may only be allowed once or as the exact command for the session.

If `ctx.hasUI` is false, prompt-required bash actions are blocked with a clear
reason.

For compounds with multiple ask-required parts:

- Abort
- Allow once

Session grants:

- exact bash command grants
- bash bucket grants, e.g. `bash:write`
- non-bash tool-name grants

Do not persist session grants. They reset on reload/restart and whenever the
active guardrail mode changes.

### Active tools and enforcement

Use both layers:

1. `pi.setActiveTools(...)` narrows what the LLM sees.
2. `tool_call` is hard enforcement.

Active tool calculation:

- Include non-bash tools that appear in active mode `allow` or `ask` and are
  currently registered.
- Include `bash` if any bash subset appears in active mode `allow` or `ask`.
- Exclude everything else.

When guardrail sees a late/unknown tool call from another extension, enforce the
policy decision for that call. Do not aggressively poll the tool registry or
proactively remove extension-owned late tools from active tools; that can be
unfriendly to other extensions and cause runtime bugs.

Do not automatically reload YAML. `/guardrail reload` explicitly reloads YAML
and recomputes active tools from the newly loaded policy and currently
registered tools.

### Human commands

- Do not guard `user_bash` (`!` / `!!`) commands.
- `/guardrail discover <cli>` is allowed regardless of active mode because it is
  human-invoked.

### System prompt guidance

Inject guardrail guidance in `before_agent_start` by returning a replacement
`systemPrompt`. Do not use an append-style return such as `systemPromptAppend`;
current pi extension APIs expect
`{ systemPrompt: event.systemPrompt + guidance }`.

Do not include huge command lists. Include:

- active mode
- allowed capabilities
- ask capabilities
- denied capabilities
- bash group descriptions for read/write/dangerous
- in hand-hold: approval-required tools must not be batched with other
  approval-required calls
- if unsure whether a bash command is `bash:read`, assume it requires approval

Example hand-hold guidance:

```text
Guardrail mode: hand-hold.

Allowed without approval:
- read
- grep
- find
- ls
- bash commands classified as bash:read

Requires approval, one at a time:
- write
- edit
- bash commands classified as bash:write
- bash commands classified as bash:dangerous
- bash commands classified as bash:unknown, by built-in guardrail behavior

When an action requires approval, do not call it in parallel with any other approval-required action. Wait for the result before requesting another. If unsure whether a bash command is bash:read, assume it requires approval.
```

### CLI discovery

`/guardrail discover <cli>`:

- command only, not an LLM tool
- allowed regardless of active mode
- recursively runs `<cli> ... --help` like `assist`
- uses safe process spawning, not shell interpolation
- has timeout, depth limit, and concurrency limit
- classifies discovered commands into:
  - read
  - write
  - unknown
- does not classify dangerous; user/LLM can move entries to `dangerous`
- outputs text only
- does not modify config
- emits pasteable YAML groups for read/write
- emits unknown as a commented YAML block

Example output shape:

```yaml
bash:
  read:
    - name: gh-read
      description:
        GitHub CLI commands discovered from --help and heuristically classified
        as read-only.
      commands:
        - gh pr list
        - gh repo view

  write:
    - name: gh-write
      description:
        GitHub CLI commands discovered from --help and heuristically classified
        as state-changing.
      commands:
        - gh issue create
        - gh pr edit

# Unknown commands discovered for gh.
# Review manually before moving any command to bash.read, bash.write, or bash.dangerous.
# unknown:
#   - gh browse
#   - gh alias
```

## Implementation plan

The plan describes the system as a sequence of **product behaviors** —
what the user or the model observes — not files, classes, modules, tests,
or harnesses. Phases are vertical slices: every behavior listed in a
phase is reachable through a real user or model action by the end of
that phase.

Phases are ordered risk-first, then value-later. Phases 0–4 establish the
fail-safe and correctness guarantees the rest of the system depends on.
Phase 5 turns the policy engine into the enforcement the model actually
sees. Phases 6–7 are user ergonomics on a correct core. Phase 8 is a
convenience feature that never affects enforcement.

### Build conventions (apply across all phases)

- No stubs, no `TODO` branches, no "to be implemented later" code. If a
  behavior is not in the current phase, the surface that would expose it
  does not exist yet.
- Implementation follows
  `foundation/testing/docs/dependency-injection.md` and
  `foundation/testing/docs/testing-harness.md`. Dependency seams are
  introduced only when a test in the current cycle needs to replace
  something; nothing is pre-declared for future phases.
- Pragmatic test tooling is built as it's needed. Cross-cutting harnesses
  (in the spirit of `pi-review/testing/setupTmpDir.ts`) are fine when
  several behaviors share the same setup.
- Behaviors that are clearly one concern stay in the same file until a
  real reason to split appears (duplication, a second consumer, a test
  seam that demands it). The plan does not prescribe file names or
  locations.
- Established terms are used exactly: `hand-hold`, `read-only`,
  `bash:read`, `bash:write`, `bash:dangerous`, `bash:unknown`,
  `effective policy`, `deny-only safety prefix`, `compound`,
  `simple part`, `session grant`, `config-error deny-all mode`.

### Phase 0 — Tracer bullet

- When pi is started with `--guardrail read-only` and no prior user
  configuration, the model cannot perform a `write` tool call.
- When pi is started without `--guardrail`, or with `--guardrail off`,
  guardrail enforcement is disabled and the model can perform any
  registered tool call.
- An invalid value to `--guardrail` does not silently degrade. The user
  sees a clear status or notification.

### Phase 1 — Fail-safe configuration

This phase only covers configuration concerns that are independent of
any specific feature. Feature-specific validation rules live with the
phase that introduces the feature they protect.

- With no prior user configuration, the system runs on a built-in
  default policy.
- When the configuration source cannot be read, the system enters
  `config-error deny-all mode`: no model tool call is permitted, and
  the user can see that the system is in this state.
- When the configuration cannot be parsed, the system enters
  `config-error deny-all mode`.
- When the configuration's top-level shape is wrong enough that no
  active mode can be determined, the system enters
  `config-error deny-all mode`.

### Phase 2 — Bash classification

`--guardrail hand-hold` starts pi in `hand-hold` mode, extending the
`--guardrail` values introduced in Phase 0. Starting pi without a
`--guardrail` flag now defaults to `hand-hold` mode (replacing the
Phase 0 no-flag behavior of disabled enforcement).

For any bash command the model issues, the system decides which
category it belongs to: read, write, dangerous, or unknown.

- A command equal to a configured prefix matches it. A command
  beginning with a prefix followed by a space matches it.
- An object-form entry uses its `command` field as the prefix.
- A configured `except` excludes a match when any static argument
  equals the excepted option or starts with `<excepted>=`.
- A command containing an unsafe redirect is unknown regardless of its
  prefix.
- A command that cannot be parsed is unknown.
- When multiple configured prefixes match, the longest match wins.

Classification is observable through enforcement in the active mode:

- A bash command whose category the active mode allows runs.
- A bash command whose category the active mode denies is blocked.
- A bash command whose category the active mode asks about causes the
  user to be asked to approve it. The prompt's option list is
  elaborated in Phase 3; for now, the user can approve or abort.
- An unknown bash command is denied in `read-only` and causes the user
  to be asked to approve it in `hand-hold`.

Configuration validation this phase introduces (the bash vocabulary
starts to mean something here):

- A configuration with a malformed bash group (missing name,
  description, or commands, or with the wrong entry shape) puts the
  system in `config-error deny-all mode`.
- A configuration that mentions a bash capability the system does not
  recognise (bare `bash`, or `bash:<anything other than read | write |
dangerous>`) puts the system in `config-error deny-all mode`.
- A configuration that mentions `bash:unknown` in any of a mode's
  `allow`, `ask`, or `deny` lists puts the system in
  `config-error deny-all mode`.
- A configuration where any mode lists the same capability under more
  than one of `allow`, `ask`, or `deny` puts the system in
  `config-error deny-all mode`.

### Phase 3 — Compound bash commands and session grants

The model issues a compound bash command (multiple simple parts joined
by shell connectors). The system treats it as one decision.

- If any simple part is denied, the whole compound is denied.
- If exactly one simple part requires approval, the user is asked about
  that part; on approval, the whole compound runs.
- If multiple simple parts require approval, the user is asked once
  about the whole compound; only allow-once is offered.
- If the compound cannot be split, the whole command is treated as
  unknown and no exact-command session grant is offered.

Bash prompts and session grants:

- A bash simple command, or a compound with exactly one risky part,
  that requires approval prompts the user with: Abort / Allow once /
  Allow exact command for session / Allow `bash:<classification>` for
  session, where `<classification>` is `read`, `write`, or
  `dangerous`.
- An unknown bash command never offers a classification-wide session
  grant.
- Session grants do not persist across reload, restart, or mode
  change.
- `/guardrail reload` re-reads configuration, applies it, and clears
  session grants. The user sees the same diagnostics as at startup.
- `/guardrail read-only` and `/guardrail hand-hold` switch modes and
  clear session grants. They are unavailable in `config-error deny-all
mode`.

### Phase 4 — Cross-category overlap rejection

- When two configured bash prefixes overlap across different
  categories (read, write, dangerous), both are rejected as one
  conflict group; the rest of the configuration still produces a
  usable effective policy.
- A rejected prefix still denies any command that matches it.
- After a load that rejected entries, the user sees a concise warning
  naming the count of rejected entries and conflict groups and
  pointing to `/guardrail doctor`.
- Same-category overlaps are kept; if useful, the user sees a warning,
  but the configuration is accepted.
- `/guardrail doctor` reports the diagnostics produced by the same
  load path — ok, warnings, errors — including precise locations
  within the configuration for rejected entries and explanations for
  each cross-category conflict. Doctor never modifies configuration;
  if the user has no configuration file, doctor reports what startup
  or reload would create rather than creating it.

### Phase 5 — Non-bash tool enforcement

This phase extends mode enforcement from bash (Phase 2) and bash
session grants (Phase 3) to the remaining tool surface.

Enforcement behaviors:

- The model only sees tools that the active mode lists under `allow`
  or `ask`, filtered to those pi has registered.
- The model sees `bash` if any bash subset is in `allow` or `ask` for
  the active mode.
- A tool that the active mode does not list under `allow` or `ask` is
  denied when the model calls it.
- A tool in `ask` prompts the user with: Abort / Allow once / Allow
  this tool for session.
- When pi has no UI, any tool call that would require a prompt is
  blocked with a clear reason instead.
- A tool registered after activation by another extension is enforced
  at call time without rewriting the active tool set retroactively.

### Phase 6 — Human commands

- `/guardrail` and `/guardrail status` tell the user the current mode,
  whether any configuration entries were rejected, and whether the
  system is in `config-error deny-all mode`.
- `/guardrail off` restores the tool set the user had before guardrail
  activated (filtered to currently registered tools). Available in
  `config-error deny-all mode`.
- `/guardrail reset-to-default` overwrites the user's persisted
  configuration with the shipped default after confirmation.
- After the user edits their configuration and runs `/guardrail
reload`, the new policy takes effect.
- `/read-only` and `/hand-hold` are aliases.

### Phase 7 — System prompt guidance

- At the start of each agent turn, the model's system prompt includes
  a guidance section that names the active mode, what is allowed
  without approval, what requires approval, what is denied, and the
  description text for each bash group in the active policy.
- In `hand-hold`, the guidance tells the model not to batch
  approval-required calls and to assume an unsure bash command
  requires approval.
- The guidance never contains long command lists.
- Rejected configuration entries never appear in the guidance.
- In `config-error deny-all mode`, the guidance reflects the deny-all
  state.

### Phase 8 — CLI discovery

- `/guardrail discover <cli>` is available to the user regardless of
  active mode.
- The system invokes `<cli> ... --help` recursively, with limits on
  depth, time, and concurrency.
- Discovered commands are classified as read, write, or unknown.
  Dangerous classification is never inferred automatically.
- Output is text only: pasteable YAML groups for read and write, and a
  commented YAML block for unknown commands.
- The system never modifies configuration during discovery.
