# pi-guardrail implementation plan

## Goal

Build `pi-guardrail`, a policy-only pi extension that steers model tool use into `hand-hold` or `read-only` modes. It complements `pi-sandbox`: guardrail decides whether the model may attempt a tool/command; sandbox enforces filesystem/network/resource access if the attempt runs.

Human commands are outside guardrail policy. The mode is for LLM tool use only.

`read-only` is a conservative LLM steering mode, not a filesystem write-prevention guarantee. Its default policy should avoid obvious project-mutating commands and known write-producing command forms, but it does not prove that an arbitrary shell command cannot write under every flag, expansion, or path choice. Path-level decisions such as allowing scratch writes under `/tmp/*` belong to `pi-sandbox` or to a future path-aware policy mechanism, not to the initial prefix classifier.

## Non-goals

- `pi-guardrail` is not a sandbox or shell security boundary and does not attempt to prove command safety under all shell expansion behavior, including environment variable expansion, command substitution, aliases, functions, or glob expansion.
- `pi-guardrail` is a policy and pacing layer for common model tool-use mistakes. Filesystem, network, and process isolation remain the responsibility of `pi-sandbox`.
- Bash classification may reject unsupported shell constructs as `bash:unknown`, but hacker-proof shell analysis is intentionally out of scope.
- Initial bash classification is not path-aware. It does not distinguish writing `/tmp/out.log` from overwriting an existing project file. Command forms with known write-producing flags should therefore be excluded from `bash:read` by default unless a future classifier can evaluate target paths against sandbox or policy rules.
- `pi-guardrail` does not aggressively poll Pi's tool registry or proactively disable tools registered later by other extensions. Late tools are handled lazily by `tool_call` enforcement so guardrail does not fight extension-owned runtime tool management.

## Resolved decisions

### Package and user interface

- Package name: `pi-guardrail`.
- Global-only policy file: `~/.pi/agent/guardrail.yaml`.
- If the policy file does not exist, create it once from the shipped commented default.
- After creation, YAML is the single source of truth. Do not merge hidden internal defaults into an existing YAML file.
- The shipped default YAML must include all default policy state, including bash classification groups. App source may contain the default YAML text, but must not contain separate hidden bash default groups that are merged at load time.
- Add `/guardrail reset-to-default` to overwrite `~/.pi/agent/guardrail.yaml` with the shipped default after confirmation.
- Runtime default: loaded extension starts in `hand-hold` mode.
- CLI flag:
  - `--guardrail read-only`
  - `--guardrail hand-hold`
  - `--guardrail off`
- `--guardrail` is a string pi flag; validate the value manually. Only `read-only`, `hand-hold`, and `off` are valid. Invalid values fail safe and report a clear status/notification.
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

- If startup or reload cannot read/parse/validate `guardrail.yaml`, deny everything for the model:
  - `pi.setActiveTools([])`
  - `tool_call` blocks every model tool call
  - status shows config error
- Validation has two severities:
  - fatal errors for unreadable YAML, parse failures, schema/type errors, invalid modes, invalid capability names, and invalid bash group shape
  - non-fatal bash policy diagnostics for rejected bash command entries that can be excluded from normal classification while preserving the rest of the policy
- Non-fatal bash policy diagnostics do not enter deny-all config-error mode. Startup/reload continues with the invalid bash entries removed from the normal classifier, retained as deny-only safety prefixes, and emits a visible warning that names the rejected entries and how to inspect them with `/guardrail doctor`.
- Human commands remain available:
  - `/guardrail status`
  - `/guardrail doctor`
  - `/guardrail reload`
  - `/guardrail reset-to-default`
  - `/guardrail off`
- `/guardrail off` is allowed after config failure because it is explicit human action.
- `/guardrail off` restores the active tool list that existed before guardrail first activated, filtered to currently registered tools.

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
- `read-only` means the model may use configured inspection tools and bash commands classified as `bash:read`; it does not guarantee that no filesystem write can occur. The default policy still treats known write-producing forms as non-read because the mode is intended to prevent routine model-initiated project mutation.
- Bare `bash` is invalid.
- Valid bash capabilities:
  - `bash:read`
  - `bash:write`
  - `bash:dangerous`
- Any other `bash:*` is invalid.
- `bash:unknown` is reserved and must not appear in YAML `allow`, `ask`, or `deny` lists. Unknown bash commands are handled by built-in mode behavior: deny in `read-only`, ask in `hand-hold`. This prevents invalid classifier entries from becoming less restrictive through fallback to a configurable unknown bucket.
- Non-bash tool names may be configured before that tool exists. This supports tools registered by other extensions.

Default policy content should be safe and visible in the generated YAML. This full generated default must include both mode capability lists and the bash classification groups those modes reference:

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

Bash policy entries are groups only. No mixed bare strings at the `read`/`write`/`dangerous` list level.

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
- when an object entry has `except`, classify it as non-matching if any parsed static argument after the command prefix is exactly the excepted option or starts with `except + "="`

Cross-category overlaps are invalid:

- Normalize every bash command entry to its effective prefix, using the `command` field for object entries.
- If two effective prefixes are equal, or one is a prefix parent of the other by the same matching rule, and they belong to different categories (`read`, `write`, `dangerous`), reject both entries from the effective bash classifier as one conflict group.
- Allow same-category overlaps, but report them as warnings if useful because they are redundant or rely on longest-prefix matching only for same-category specificity.
- Rejected prefixes are removed from normal read/write/dangerous classification but retained in a deny-only safety prefix list checked before normal classification. This keeps non-fatal diagnostics fail-safe: an invalid rejected prefix must not become less restrictive by falling through to ordinary unknown handling.
- After validation removes rejected entries from the normal classifier, classification must use deterministic longest-prefix matching. Longest-prefix matching is for deterministic same-category behavior, not for resolving cross-category conflicts.
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

If a command matches a rejected deny-only safety prefix, deny it before normal classification. If no read/write/dangerous rule matches after applying `except`, classify the command as `bash:unknown`.

Keep the default read list conservatively curated like `assist`. Do not classify broad git command families such as `git branch` or `git remote` as `bash:read` by default; they include mutating forms and remain `bash:unknown` unless the policy later adds explicitly narrowed read-oriented forms.

Do not try to close every possible shell angle in the prefix classifier. The intended line is: exclude known write-producing forms that are visible in parsed static command parts, classify unsupported or ambiguous forms as `bash:unknown`, and leave real filesystem/path enforcement to `pi-sandbox`.

`bash.read/write/dangerous[*].description` feeds system prompt guidance. Do not dump large command lists into the prompt.

### Policy diagnostics and doctor

Policy load returns both an effective policy and diagnostics:

- fatal diagnostics: no effective policy is produced; guardrail enters config-error deny-all mode
- non-fatal diagnostics: an effective policy is produced after rejected bash entries are removed from normal classification and retained as deny-only safety prefixes

At startup and `/guardrail reload`, if non-fatal diagnostics exist:

- emit one concise visible warning/status notification
- include the count of rejected bash entries and conflict groups
- name `/guardrail doctor` as the command for the full report
- keep running with the effective policy

`/guardrail doctor` re-runs the same schema validation, bash overlap validation, and effective-policy construction used by startup/reload, but through a non-mutating config read path. Do not implement a second validator for doctor. Keep the filesystem behavior split:

- startup and `/guardrail reload` use the load path that ensures `~/.pi/agent/guardrail.yaml` exists by creating it from the shipped default when missing
- `/guardrail doctor` reads the current file if present; if it is missing, report that startup/reload would create the default, but do not create or overwrite anything

Doctor output:

- reports `ok`, `warning`, and `error` diagnostics
- shows exact YAML paths for rejected bash entries, including category, group name, command index, and command prefix
- explains why each cross-category overlap was rejected
- shows whether guardrail would run normally, run with rejected entries ignored, or enter config-error deny-all mode
- never modifies config

If a package-level CLI command is added later, `pi-guardrail doctor --config <path>` and `pi-guardrail doctor --json` should use this same validator. The slash command is required for the initial implementation; a package CLI is optional.

### Bash classification

- Adapt `assist` shell parsing/classification code from `~/Projects/assist`, especially `splitCompound` behavior. Preserve source/license attribution in comments or docs for copied or closely adapted code.
- Keep shell parsing/classification feature-private under `features/tool-enforcement/shell/` unless another production feature needs the same parser. Only then promote a thin root `shell/` shared module.
- Use `shell-quote` rather than writing a simpler parser.
- Apply `except` checks only to parsed static command parts. Do not expand the classifier scope into shell-hardening; shell expansion bypass resistance is a non-goal for `pi-guardrail`.
- Reject or classify unsafe redirects as `bash:unknown`, matching `assist` behavior.
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
5. Else if exactly one part maps to `ask`, prompt for that part; if approved, run the whole command.
6. Else if multiple parts map to `ask`, prompt once for the whole compound; only allow-once is offered.
7. Else all parts are allowed; run.

If splitting fails, classify the whole command as `bash:unknown` and do not offer per-session exact grants.

### Ask prompts and session grants

For non-bash tools in `ask`, prompt options:

- Abort
- Allow once
- Allow this tool for session

If `ctx.hasUI` is false, use the same conservative behavior as `pi-sandbox`: treat prompt-required actions as aborted and block with a clear reason. Do not auto-approve in non-interactive/no-UI contexts.

For simple bash commands or compounds with exactly one risky part:

- Abort
- Allow once
- Allow exact command for session
- Allow `bash:<classification>` for session, only when classification is one of `bash:read`, `bash:write`, or `bash:dangerous`

For `bash:unknown`, do not offer a classification-wide session grant. Unknown commands may only be allowed once or as the exact command for the session.

If `ctx.hasUI` is false, prompt-required bash actions are blocked with a clear reason.

For compounds with multiple ask-required parts:

- Abort
- Allow once

Session grants:

- exact bash command grants
- bash bucket grants, e.g. `bash:write`
- non-bash tool-name grants

Do not persist session grants. They reset on reload/restart and whenever the active guardrail mode changes.

### Active tools and enforcement

Use both layers:

1. `pi.setActiveTools(...)` narrows what the LLM sees.
2. `tool_call` is hard enforcement.

Active tool calculation:

- Include non-bash tools that appear in active mode `allow` or `ask` and are currently registered.
- Include `bash` if any bash subset appears in active mode `allow` or `ask`.
- Exclude everything else.

When guardrail sees a late/unknown tool call from another extension, enforce the policy decision for that call. Do not aggressively poll the tool registry or proactively remove extension-owned late tools from active tools; that can be unfriendly to other extensions and cause runtime bugs.

Do not automatically reload YAML. `/guardrail reload` explicitly reloads YAML and recomputes active tools from the newly loaded policy and currently registered tools.

### Human commands

- Do not guard `user_bash` (`!` / `!!`) commands.
- `/guardrail discover <cli>` is allowed regardless of active mode because it is human-invoked.

### System prompt guidance

Inject guardrail guidance in `before_agent_start` by returning a replacement `systemPrompt`.
Do not use an append-style return such as `systemPromptAppend`; current pi extension APIs expect
`{ systemPrompt: event.systemPrompt + guidance }`.

Do not include huge command lists. Include:

- active mode
- allowed capabilities
- ask capabilities
- denied capabilities
- bash group descriptions for read/write/dangerous
- in hand-hold: approval-required tools must not be batched with other approval-required calls
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
      description: GitHub CLI commands discovered from --help and heuristically classified as read-only.
      commands:
        - gh pr list
        - gh repo view

  write:
    - name: gh-write
      description: GitHub CLI commands discovered from --help and heuristically classified as state-changing.
      commands:
        - gh issue create
        - gh pr edit

# Unknown commands discovered for gh.
# Review manually before moving any command to bash.read, bash.write, or bash.dangerous.
# unknown:
#   - gh browse
#   - gh alias
```

## Proposed directory structure

Follow the pendant directory-structure guidance: app composition lives in the root entrypoint, user-facing behavior lives in `features/`, and genuinely shared modules sit flat at the package root.

### Shared module placement rule

Code starts feature-private. Promote code to a shared root module only when all of these are true:

1. At least two production features depend on the same stable concept.
2. The concept has domain language independent of either feature.
3. The shared module exposes a thin public interface and keeps implementation details private.
4. The shared module is not just a bag of helpers, text constants, convenience wrappers, or premature abstractions.

Shared modules bind features together, so keep them as thin as possible. Their public surface should be the minimum contract needed by their consumers. Treat any exported function/type imported from outside the module as public API. Keep public API files few and small; keep parsing, normalization, formatting, and bookkeeping as module-private implementation details. Do not broaden a shared API for hypothetical future callers.

If a shared module later has only one production consumer, inline it back into that feature. The root modules in the tree below are expected shared modules, not permission to create unused layers; during implementation, move or delete any root module that does not earn shared status.

Feature-local slice files are optional. Do not create `features/<feature>/<shared-module>.ts` just to mirror a dependency. Create a slice only when it translates the shared module into feature-specific language, narrows the shared API for that feature, or protects the feature from shared-module churn.

There must be exactly one `index.ts`: the root app composition file. Do not create `index.ts` files inside modules or features. Import exact module files directly, e.g. `./policy/validation.ts`, `./features/tool-enforcement/tool-call.ts`.

Tests live next to the concern they verify. Every production concern below has a colocated `.test.ts` file or local `tests/` coverage. Shared test helpers are created only after at least two test areas need the same fixture/assertion pattern.

```text
pi-guardrail/
  package.json
  package-lock.json
  tsconfig.json
  README.md
  guardrail.yaml                  # shipped commented default, copied on first run
  index.ts                        # app/extension composition only: imports exact files and registers flags, commands, events
  index.test.ts                   # composition, startup defaults, flag validation smoke coverage

  config/                         # shared module: config paths, default creation, reset-to-default
    CLAUDE.md
    paths.ts
    paths.test.ts
    defaults.ts
    defaults.test.ts
    load.ts
    load.test.ts
    reset.ts
    reset.test.ts

  policy/                         # shared module: YAML schema, validation, policy lookup, mode decisions
    CLAUDE.md
    schema.ts
    validation.ts
    validation.test.ts
    diagnostics.ts                # validation diagnostic types, formatting inputs, effective-policy status
    diagnostics.test.ts
    decisions.ts
    decisions.test.ts
    bash.ts                       # policy-level bash groups, prefix matching, except handling
    bash.test.ts

  session-grants/                 # shared module: in-memory session grant state and matching
    CLAUDE.md
    grants.ts
    grants.test.ts
    bash.ts
    bash.test.ts
    tools.ts
    tools.test.ts

  active-tools/                   # shared module: compute/apply active tool names and restore previous tools
    CLAUDE.md
    active-tools.ts
    active-tools.test.ts
    policy.ts                     # active-tools' use of policy
    policy.test.ts

  ui/                             # shared module: generic interaction mechanics and no-UI behavior
    CLAUDE.md
    confirm.ts
    confirm.test.ts
    choice-prompt.ts
    choice-prompt.test.ts

  features/
    mode-control/                 # feature: /guardrail commands, aliases, reload/off/mode changes
      CLAUDE.md
      commands.ts
      commands.test.ts
      doctor.ts                   # /guardrail doctor report rendering over policy diagnostics
      doctor.test.ts

    tool-enforcement/             # feature: tool_call hard enforcement
      CLAUDE.md
      tool-call.ts
      tool-call.test.ts
      approval-copy.ts            # feature-private approval prompt wording
      approval-copy.test.ts
      shell/                      # feature-private adapted assist shell parsing/classification primitives
        CLAUDE.md
        split-compound.ts
        split-compound.test.ts
        group-by-operator.ts
        group-by-operator.test.ts
        redirects.ts
        redirects.test.ts
        backticks.ts
        backticks.test.ts

    prompt-guidance/              # feature: before_agent_start system prompt replacement
      CLAUDE.md
      before-agent-start.ts
      before-agent-start.test.ts
      guidance.ts                 # feature-private system prompt guidance wording
      guidance.test.ts

    cli-discovery/                # feature: /guardrail discover <cli>
      CLAUDE.md
      command.ts
      command.test.ts
      input.ts                    # feature-private discover argument validation
      input.test.ts
      run-help.ts
      run-help.test.ts
      parse-commands.ts
      parse-commands.test.ts
      classify-command.ts
      classify-command.test.ts
      format-yaml.ts
      format-yaml.test.ts

  plans/
    2026-05-07-blad-bloom.md
```

If a file grows, promote that concern to a directory, but still do not add module-local `index.ts` files. Example:

```text
features/tool-enforcement/shell/
  split-compound/
    tokenize.ts
    tokenize.test.ts
    operators.ts
    operators.test.ts
    split-compound.ts
    split-compound.test.ts
  redirects.ts
  redirects.test.ts
```

## Implementation phases

### Phase 1 — package skeleton and default policy

- Create `pi-guardrail/package.json` with:
  - `type: "module"`
  - `pi.extensions: ["./index.ts"]`
  - runtime dependencies:
    - `yaml`
    - `shell-quote`
  - peer dependency on `@mariozechner/pi-coding-agent`
  - dev dependencies for TypeScript and pi types
  - `@types/shell-quote` only if `shell-quote` does not ship usable TypeScript types
- Add `tsconfig.json`, `README.md`, `guardrail.yaml`, root `index.ts`, justified shared-module `CLAUDE.md` files, feature `CLAUDE.md` files, and initial colocated tests. Do not create placeholder shared modules; in particular, do not create root `prompts/` or `testing/` up front.
- Implement config concern files:
  - `config/paths.ts`: resolve `~/.pi/agent/guardrail.yaml` via pi `getAgentDir()` if available
  - `config/defaults.ts`: shipped default YAML content
  - `config/load.ts`: create default if missing and load YAML text
  - `config/reset.ts`: reset default with confirmation from command
- Register `--guardrail` as a string flag in root `index.ts` and manually validate allowed values `read-only`, `hand-hold`, `off`.

### Phase 2 — policy parsing and validation

- Implement YAML schema types in `policy/schema.ts`.
- Implement validation in `policy/validation.ts`, validation diagnostic types in `policy/diagnostics.ts`, and policy action lookup in `policy/decisions.ts`.
- Implement bash policy flattening, prefix matching, and `except` handling in `policy/bash.ts`.
- Validate:
  - required `modes`
  - active mode exists
  - `allow/ask/deny` arrays are present or default to empty
  - disjoint mode entries
  - bare `bash` invalid
  - only valid `bash:*` subsets
  - bash groups have `name`, `description`, `commands`
  - cross-category bash prefix overlaps
- Fatal validation errors enter error mode and deny all model tools.
- Cross-category bash prefix overlaps are non-fatal diagnostics: remove the conflicting bash entries from normal classification, retain their prefixes as deny-only safety prefixes, continue startup/reload, and keep the rest of the policy active.
- Same-category bash overlaps may remain in the effective policy; classification uses deterministic longest-prefix matching after rejected cross-category overlaps are removed.

### Phase 3 — active tools and commands

- Implement active tool calculation/restoration in `active-tools/active-tools.ts` and `active-tools/policy.ts`.
- Save initial active tools before first activation.
- Apply active tools for `hand-hold` by default.
- Implement `/guardrail` subcommands in `features/mode-control/commands.ts`. Import `config`, `policy`, `active-tools`, `session-grants`, and `ui` directly unless a feature-local slice earns its keep by translating concepts or narrowing a shared API:
  - status
  - doctor
  - off
  - read-only
  - hand-hold
  - reload
  - reset-to-default
- Add aliases `/read-only` and `/hand-hold` if command namespace remains clean.
- Startup and reload must surface non-fatal policy diagnostics with a concise visible warning. The warning should say how many bash entries were ignored and point to `/guardrail doctor` for details.
- Implement `/guardrail doctor` in `features/mode-control/doctor.ts` using the same validate/effective-policy path as startup and reload, fed by a non-mutating config read helper instead of the startup/reload load helper that creates the default file. The command must report exact rejected-entry paths and must not modify config, including when `~/.pi/agent/guardrail.yaml` is missing.

### Phase 4 — tool_call enforcement

- Implement `tool_call` handling in `features/tool-enforcement/tool-call.ts`. Import shared `policy`, `session-grants`, `active-tools`, and `ui` directly unless a feature-local slice earns its keep by translating concepts or narrowing a shared API. Keep shell parsing/classification in feature-private `features/tool-enforcement/shell/` unless another production feature needs it.
- Implement approval prompt wording in `features/tool-enforcement/approval-copy.ts`.
- Keep shared `ui/` limited to generic confirmation, choice prompting, and conservative no-UI behavior.
- Implement non-bash decisions:
  - session grant check
  - mode action lookup
  - ask prompt for `ask`
  - deny-by-default for unmentioned tools
- Implement bash decisions:
  - split/classify command
  - compound precedence
  - ask prompt rules
  - session grants
- On denied late/unknown tool call, block the call without mutating other extensions' active tool state.
- Do not intercept `user_bash`.

### Phase 5 — prompt guidance

- Implement system prompt guidance rendering in `features/prompt-guidance/guidance.ts`.
- Implement `before_agent_start` handling in `features/prompt-guidance/before-agent-start.ts`. Import `policy` directly unless a feature-local slice earns its keep by translating concepts or narrowing a shared API.
- In `before_agent_start`, return a replacement prompt:
  `{ systemPrompt: event.systemPrompt + guidance }`.
- Do not use `systemPromptAppend` or any append-style hook result.
- Include mode action lists and bash group descriptions from the effective policy only. Rejected bash entries and group descriptions that became empty after rejection must not appear in prompt guidance.
- Include hand-hold warning against parallel approval-required tool calls.

### Phase 6 — CLI discovery

- Adapt the existing working discovery approach from `~/Projects/assist`:
  - recursive `--help`
  - parse command sections
  - depth limit
  - concurrency limit
  - timeout
  - source/license attribution for copied or closely adapted code
- Accept a command name only for `/guardrail discover <cli>`: reject whitespace, shell syntax, pipes, redirects, env assignments, and arbitrary argument strings.
- Implement `/guardrail discover <cli>` in `features/cli-discovery/command.ts` with feature-private concern files `input.ts`, `run-help.ts`, `parse-commands.ts`, `classify-command.ts`, and `format-yaml.ts`.
- Use safe `spawn`/`execFile` argument arrays.
- Classify read/write/unknown with deterministic verbs.
- Output text-only report and pasteable YAML groups.
- Do not write policy.

### Phase 7 — tests

Tests should live next to the files they test or under local `tests/` directories. Every production file must have direct colocated coverage unless it is pure type-only code; type-only code must be covered through the nearest consumer test. If an optional feature-local slice is added, it must have direct colocated coverage.

Minimum unit/integration coverage:

- package/default config creation
- CLI flag validation
- YAML validation errors
- fatal versus non-fatal policy diagnostics
- disjoint mode validation
- invalid bare `bash`
- invalid configured `bash:unknown`
- unknown future non-bash tool names accepted
- mode action lookup
- unknown/unmentioned tool behavior
- no-UI `ask` blocks
- bash prefix matching
- cross-category bash prefix overlaps are rejected from normal classification and retained as deny-only safety prefixes
- same-category bash prefix overlaps use deterministic longest-prefix matching
- rejected bash entries do not feed prompt guidance
- rejected bash entries cannot become `bash:unknown` allow/ask fallbacks
- startup/reload reports non-fatal rejected bash entries without entering config-error deny-all mode
- `/guardrail doctor` re-runs validation, reports rejected entries with exact paths, and does not modify config
- bash command object matching with `except`
- `git diff --output=patch.txt`, `git log --output=log.txt`, and `git show --output=show.patch` classify as `bash:unknown`
- `git diff --output patch.txt`, `git log --output log.txt`, and `git show --output show.patch` classify as `bash:unknown`
- normal static read forms such as `git diff --cached` and `git diff -- src/file.ts` remain `bash:read`
- bash classification and compound deny/ask/allow precedence
- session grant matching
- active tool computation
- `tool_call` hard enforcement
- config failure deny-all behavior
- reload from bad config to good config
- `/guardrail discover` input rejection, parser/classifier, and output formatting

Follow project testing instruction: do not destructure array/object expectations into indexed/keyed individual assertions; assert whole structures with `toEqual`, `objectContaining`, or `arrayContaining`.

## Open implementation checks

- Confirm exact pi extension API names in the installed version before coding:
  - `registerFlag`
  - `getFlag`
  - `setActiveTools`
  - `getActiveTools`
  - `getAllTools`
  - `tool_call`
  - `before_agent_start`
- Check `pi-sandbox` UI behavior and mirror its conservative no-UI behavior for prompt-required actions.
- Check whether `ctx.ui.confirm` is enough or whether a custom prompt is needed for multi-option session grant choices.
- Check whether package runtime should import `@mariozechner/pi-coding-agent` types only or runtime helpers too.
