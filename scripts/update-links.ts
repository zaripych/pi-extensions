#!/usr/bin/env -S npx tsx
/**
 * Sync symlinks in ~/.pi/extensions/ to match extension dirs in this repo.
 * - Creates a symlink for every sibling directory containing a package.json.
 * - Removes stale symlinks in ~/.pi/extensions/ that point into this repo
 *   but whose target no longer exists.
 *
 * Override the destination via PI_EXTENSIONS_DIR.
 */
import {
  lstat,
  mkdir,
  readdir,
  readlink,
  stat,
  symlink,
  unlink,
} from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SKIP_DIRS = new Set(['scripts', 'node_modules', '.git', 'foundation'])

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DEST =
  process.env.PI_EXTENSIONS_DIR ?? join(homedir(), '.pi', 'agent', 'extensions')

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

async function readLinkOrNull(path: string): Promise<string | null> {
  try {
    const info = await lstat(path)
    if (!info.isSymbolicLink()) return null
    return await readlink(path)
  } catch {
    return null
  }
}

async function syncLinks(): Promise<void> {
  await mkdir(DEST, { recursive: true })

  const entries = await readdir(ROOT, { withFileTypes: true })
  for (const entry of entries) {
    if (!entry.isDirectory() || SKIP_DIRS.has(entry.name)) continue
    const sourceDir = join(ROOT, entry.name)
    if (!(await exists(join(sourceDir, 'package.json')))) continue

    const link = join(DEST, entry.name)
    const current = await readLinkOrNull(link)
    if (current === sourceDir) {
      console.log(`ok    ${entry.name}`)
      continue
    }
    if (current !== null) {
      await unlink(link)
    } else if (await exists(link)) {
      console.error(`skip  ${entry.name} (exists, not a symlink)`)
      continue
    }
    await symlink(sourceDir, link)
    console.log(`link  ${entry.name} -> ${sourceDir}`)
  }
}

async function pruneStale(): Promise<void> {
  const links = await readdir(DEST)
  for (const name of links) {
    const link = join(DEST, name)
    const target = await readLinkOrNull(link)
    if (target === null) continue
    if (!target.startsWith(`${ROOT}/`)) continue
    if (await exists(target)) continue
    await unlink(link)
    console.log(`prune ${name}`)
  }
}

async function main(): Promise<void> {
  await syncLinks()
  await pruneStale()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
