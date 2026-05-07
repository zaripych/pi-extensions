# pi-extensions

npm workspace root for [pi](https://github.com/mariozechner/pi) extensions.

## Subtrees

| Path             | Upstream                                          |
| ---------------- | ------------------------------------------------- |
| `pi-web-fetch/`  | https://github.com/georgebashi/pi-web-fetch (main) |
| `pi-sandbox/`    | https://github.com/carderne/pi-sandbox (main)     |

### Pull updates

```bash
git subtree pull --prefix=pi-web-fetch https://github.com/georgebashi/pi-web-fetch main --squash
```

### Add a new subtree

```bash
git subtree add --prefix=<dir> <repo-url> <branch> --squash
```
