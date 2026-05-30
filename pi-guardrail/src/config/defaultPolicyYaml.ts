import dedent from 'dedent'

type Yaml = {
  (literals: string): string
  (strings: TemplateStringsArray, ...values: unknown[]): string
}

const yaml: Yaml = dedent

export const defaultPolicyYaml = yaml`
  # pi-guardrail policy.
  # Generated from the shipped default. Edit to customise; this file is the
  # single source of truth once it exists.

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
        description: "Local inspection commands that read but do not modify project files: pwd, cat, head, tail, wc, file, stat; the non-mutating git subcommands status, diff, log, and show (their --output flag is excluded because it writes a file) plus rev-parse; and --version checks for git, node, npm, pnpm, yarn, python, python3, and uv. Any of these may redirect stdout/stderr into the system scratch directory (os.tmpdir(), e.g. $TMPDIR) and still count as bash:read; redirecting to any other path is not bash:read."
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
            exclude:
              - --output
          - command: git log
            exclude:
              - --output
          - command: git show
            exclude:
              - --output
          - git rev-parse

    write:
      - name: package-managers
        description: "Package-manager commands that add, remove, or update dependencies or lockfiles: npm install/uninstall/update, pnpm install/add/remove/update, yarn install/add/remove, and uv add/remove/sync."
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
        description: "Shell and system commands that can irreversibly destroy data or alter machine state: rm and rmdir (delete files/directories); sudo (run as another user); chmod, chown, and chgrp (change permissions/ownership); kill, pkill, and killall (terminate processes); shutdown and reboot (power state); and dd, mkfs, mount, and umount (raw disk and filesystem operations)."
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
`
