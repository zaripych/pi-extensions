export const defaultPolicyYaml = `# pi-guardrail policy.
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
      description: "Basic local inspection commands: pwd, cat, head, tail, wc, file, stat, git status/diff/log/show/rev-parse, and common --version checks."
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
      description: "Shell/system commands that delete files, change ownership/permissions, kill processes, or affect disks/system state."
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
