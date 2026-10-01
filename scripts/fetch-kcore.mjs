#!/usr/bin/env node
// fetch-kcore.mjs [--pins <file>] <target>... | all
//
// Downloads the kcore Release packages named in scripts/kcore-pins.json, checks each tarball against
// its sha256 pin, and checks the members this package uses (include/kcore.h and the pinned member)
// against the package's own SHAKE256SUMS. Copies them to vendor/<target>/; for wasm32 the module
// goes to ./kcore.wasm. Prints "FETCH_KCORE ok <target> <dest>" per target, or
// "FETCH_KCORE FAIL <reason>" and exits 1. Tarballs are cached in vendor/.cache/.
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function fail (reason) {
  console.log(`FETCH_KCORE FAIL ${reason}`)
  process.exit(1)
}

function digest (algorithm, data, options) {
  return createHash(algorithm, options).update(data).digest('hex')
}

const args = process.argv.slice(2)
let pinsPath = join(ROOT, 'scripts', 'kcore-pins.json')
const pinsAt = args.indexOf('--pins')
if (pinsAt !== -1) {
  if (!args[pinsAt + 1]) fail('--pins needs a file')
  pinsPath = resolve(args[pinsAt + 1])
  args.splice(pinsAt, 2)
}
const pins = JSON.parse(readFileSync(pinsPath, 'utf8'))
const targets = args.length === 1 && args[0] === 'all' ? Object.keys(pins.targets) : args
if (targets.length === 0) fail('usage: fetch-kcore.mjs [--pins <file>] <target>... | all')

for (const target of targets) {
  const pin = pins.targets[target]
  if (!pin) fail(`unknown target ${target}`)
  const name = `knishio-crypto-core-${pins.version}-${target}`
  const cache = join(ROOT, 'vendor', '.cache', `${name}.tar.gz`)
  if (!existsSync(cache)) {
    const url = pins.url.replaceAll('{version}', pins.version).replaceAll('{target}', target)
    const res = await fetch(url)
    if (!res.ok) fail(`download ${url} HTTP ${res.status}`)
    mkdirSync(dirname(cache), { recursive: true })
    writeFileSync(cache, Buffer.from(await res.arrayBuffer()))
  }
  if (digest('sha256', readFileSync(cache)) !== pin.sha256) fail(`sha256 ${name}.tar.gz`)

  const tmp = mkdtempSync(join(tmpdir(), 'kcore-fetch-'))
  try {
    execFileSync('tar', ['-xzf', cache, '-C', tmp])
    const pkg = join(tmp, name)
    const listed = new Map()
    for (const line of readFileSync(join(pkg, 'SHAKE256SUMS'), 'utf8').split('\n')) {
      if (!line) continue
      const at = line.indexOf('  ')
      listed.set(line.slice(at + 2), line.slice(0, at))
    }
    for (const member of ['include/kcore.h', pin.member]) {
      const data = readFileSync(join(pkg, member))
      if (listed.get(member) !== digest('shake256', data, { outputLength: 32 })) fail(`shake256 ${member}`)
    }
    let dest
    if (target === 'wasm32') {
      dest = join(ROOT, 'kcore.wasm')
      copyFileSync(join(pkg, pin.member), dest)
    } else {
      const base = join(ROOT, 'vendor', target)
      rmSync(base, { recursive: true, force: true })
      for (const member of ['include/kcore.h', pin.member]) {
        mkdirSync(dirname(join(base, member)), { recursive: true })
        copyFileSync(join(pkg, member), join(base, member))
      }
      dest = base
    }
    console.log(`FETCH_KCORE ok ${target} ${dest}`)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}
