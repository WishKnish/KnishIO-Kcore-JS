#!/usr/bin/env node
// check-pack.mjs <tgz>: the npm tarball must hold exactly the shipped files (the loaders, the types,
// kcore.wasm, one kcore.node per target, LICENSE/LICENSE-mlkem-native/README/CHANGELOG and
// package.json) and nothing else.
// Prints "PACK ok <n> files" or "PACK FAIL missing=<...> extra=<...>" and exits 1.
import { execFileSync } from 'node:child_process'

const TARGETS = ['linux-x64-gnu', 'linux-arm64-gnu', 'linux-x64-musl', 'linux-arm64-musl', 'darwin-universal', 'windows-x64']
const expected = new Set([
  ...['package.json', 'index.cjs', 'index.mjs', 'index.d.ts', 'kcore.wasm', 'LICENSE', 'LICENSE-mlkem-native', 'README.md', 'CHANGELOG.md'],
  ...TARGETS.map((t) => `prebuilds/${t}/kcore.node`)
].map((f) => `package/${f}`))

const tgz = process.argv[2]
if (!tgz) {
  console.log('usage: check-pack.mjs <tgz>')
  process.exit(2)
}
const members = new Set(execFileSync('tar', ['-tzf', tgz], { encoding: 'utf8' }).split('\n').filter((m) => m && !m.endsWith('/')))
const missing = [...expected].filter((m) => !members.has(m))
const extra = [...members].filter((m) => !expected.has(m))
if (missing.length || extra.length) {
  console.log(`PACK FAIL missing=${missing.join(',') || '-'} extra=${extra.join(',') || '-'}`)
  process.exit(1)
}
console.log(`PACK ok ${members.size} files`)
