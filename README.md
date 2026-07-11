# pi-extensions

npm workspace root for [pi](https://github.com/mariozechner/pi) extensions.

## Subtrees

| Path             | Upstream                                           |
| ---------------- | -------------------------------------------------- |
| `pi-web-fetch/`  | https://github.com/georgebashi/pi-web-fetch (main) |
| `pi-sandbox/`    | https://github.com/carderne/pi-sandbox (main)      |
| `pi-neuralwatt/` | https://github.com/aliou/pi-neuralwatt (main)      |

### Pull updates

```bash
git subtree pull --prefix=pi-web-fetch https://github.com/georgebashi/pi-web-fetch main --squash
# or for pi-neuralwatt:
# git subtree pull --prefix=pi-neuralwatt git@github.com:aliou/pi-neuralwatt.git main --squash
```

### Add a new subtree

```bash
git subtree add --prefix=<dir> <repo-url> <branch> --squash
```

## Subrepos

Managed with [git-subrepo](https://github.com/ingydotnet/git-subrepo).

| Path          | Upstream                                      |
| ------------- | --------------------------------------------- |
| `foundation/` | https://github.com/zaripych/foundation (main) |

### Pull updates

```bash
git subrepo pull foundation
```
