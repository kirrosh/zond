#!/usr/bin/env node
// npm postinstall: download the platform binary from the GitHub release
// matching this package version, verify its sha256, drop it next to the
// bin launcher. Pure node stdlib — the published package has zero deps.
import { createHash } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const REPO = 'kirrosh/zond'
const PKG_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

export function resolveTarget(platform = process.platform, arch = process.arch) {
  const os = { darwin: 'darwin', linux: 'linux', win32: 'win' }[platform]
  const cpu = { x64: 'x64', arm64: 'arm64' }[arch]
  if (!os || !cpu || (os === 'win' && cpu !== 'x64')) {
    throw new Error(
      `Unsupported platform: ${platform}-${arch}. Prebuilt binaries: https://github.com/${REPO}/releases`,
    )
  }
  return `${os}-${cpu}`
}

export function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex')
}

export function expectedChecksum(checksumsText, artifact) {
  for (const line of checksumsText.split('\n')) {
    const [hash, name] = line.trim().split(/\s+/)
    if (name === artifact) return hash
  }
  throw new Error(`No entry for ${artifact} in checksums.txt`)
}

async function download(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Download failed (${res.status}): ${url}`)
  return Buffer.from(await res.arrayBuffer())
}

async function main() {
  if (process.env.ZOND_SKIP_DOWNLOAD) return
  // Dev checkout (src/ is not shipped in the npm package) — nothing to download.
  if (existsSync(join(PKG_DIR, 'src'))) return

  const { version } = JSON.parse(readFileSync(join(PKG_DIR, 'package.json'), 'utf8'))
  const target = resolveTarget()
  const artifact = target === 'win-x64' ? `zond-${target}.exe` : `zond-${target}`
  // ZOND_DOWNLOAD_BASE: mirror / clean-machine E2E override.
  const base =
    process.env.ZOND_DOWNLOAD_BASE || `https://github.com/${REPO}/releases/download/v${version}`
  const [binary, checksums] = await Promise.all([
    download(`${base}/${artifact}`),
    download(`${base}/checksums.txt`),
  ])

  const expected = expectedChecksum(checksums.toString('utf8'), artifact)
  const actual = sha256(binary)
  if (actual !== expected) {
    throw new Error(`Checksum mismatch for ${artifact}: expected ${expected}, got ${actual}`)
  }

  const dest = join(PKG_DIR, 'bin', target === 'win-x64' ? 'zond-bin.exe' : 'zond-bin')
  mkdirSync(dirname(dest), { recursive: true })
  writeFileSync(dest, binary)
  chmodSync(dest, 0o755)
  console.log(`zond ${version} (${target}) ready`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(`zond postinstall failed: ${err.message}`)
    process.exit(1)
  })
}
