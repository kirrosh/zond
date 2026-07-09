#!/usr/bin/env node
// Thin launcher: exec the platform binary fetched by scripts/npm/postinstall.mjs.
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const bin = join(
  dirname(fileURLToPath(import.meta.url)),
  process.platform === 'win32' ? 'zond-bin.exe' : 'zond-bin',
)

if (!existsSync(bin)) {
  console.error(
    'zond binary is missing — the postinstall download likely failed.\n' +
      'Re-run: npm rebuild @kirrosh/zond\n' +
      'Or install another way: https://github.com/kirrosh/zond#install',
  )
  process.exit(1)
}

const result = spawnSync(bin, process.argv.slice(2), { stdio: 'inherit' })
process.exit(result.status ?? 1)
