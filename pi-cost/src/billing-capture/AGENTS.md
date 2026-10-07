# billing-capture

## Goals

- Capture billing information in a consistent manner, based on the saved browser profile provided by the user.

## Non-goals

- Reusing a session left open with `--keep-open`. `--keep-open` is a debug aid for a single run, not a session to reconnect to. A later launch without `--port` while that browser still runs is out of scope.
- A host-side deadline for CDP commands against a blocked renderer. This issue is hypothetical — we have never reproduced it. We do not address hypothetical issues.
