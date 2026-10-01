// Package tests (node --test). They run against whatever backend loaded; CI runs them once per
// platform with KNISHIO_KCORE_EXPECT_BACKEND=napi and once with the WASM backend forced, so both
// backends are held to the same references:
//   - the cross-SDK vectors (SHAKE256, WOTS+ address of the wallet vectors),
//   - an independent node:crypto implementation of the WOTS+ chain step and address,
//   - @noble/post-quantum for ML-KEM-1024 and ML-KEM-768.
import assert from 'node:assert/strict'
import { createHash, randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { ml_kem1024 as nobleMlKem1024, ml_kem768 as nobleMlKem768 } from '@noble/post-quantum/ml-kem.js'
import kcore from '@wishknish/knishio-kcore'

const vectors = JSON.parse(readFileSync(new URL('./fixtures/cross-platform-test-vectors.json', import.meta.url), 'utf8')).vectors
const NOBLE = { 1024: nobleMlKem1024, 768: nobleMlKem768 }

const shakeHex = (text, bytes) => createHash('shake256', { outputLength: bytes }).update(text, 'latin1').digest('hex')

function referenceChains (chunks, counts) {
  let out = ''
  counts.forEach((count, i) => {
    let chunk = chunks.slice(i * 128, (i + 1) * 128)
    for (let s = 0; s < count; s++) chunk = shakeHex(chunk, 64)
    out += chunk
  })
  return out
}

function referenceAddress (key) {
  return shakeHex(shakeHex(referenceChains(key, new Array(16).fill(16)), 1024), 32)
}

// Mirrors the SDKs' Wallet.generateKey. The vectors' expectedPrivateKey is not this key; the wallet
// address is derived from it: secret/position hashed to hex when not hex, added as integers, then
// SHAKE256 over the indexed key + token and over that digest, 1024 bytes each. This is the only
// canonical WOTS+ address check that runs in standalone CI (the SDK vector suites skip there).
const isHex = (s) => /^[0-9a-fA-F]+$/.test(s)
function walletKey ({ secret, token, position }) {
  const s = isHex(secret) ? secret : shakeHex(Buffer.from(secret, 'utf8').toString('latin1'), 128)
  const p = isHex(position) ? position : shakeHex(Buffer.from(position, 'utf8').toString('latin1'), 32)
  const indexed = (BigInt(`0x${s}`) + BigInt(`0x${p}`)).toString(16)
  return shakeHex(shakeHex(indexed + Buffer.from(token, 'utf8').toString('latin1'), 1024), 1024)
}

const randomKey = () => randomBytes(1024).toString('hex')

function assertCode (fn, Ctor, code) {
  assert.throws(fn, (err) => err instanceof Ctor && err.code === code)
}

test('the expected backend loaded, at ABI 1 and kcore 0.1.0', () => {
  const expected = process.env.KNISHIO_KCORE_EXPECT_BACKEND
  if (expected) assert.equal(kcore.backend, expected)
  assert.equal(kcore.abiVersion(), 1)
  assert.equal(kcore.kcoreVersion, '0.1.0')
})

test('shake256 matches the cross-SDK vectors', () => {
  for (const t of vectors.shake256.tests) {
    const out = kcore.shake256(new TextEncoder().encode(t.input), t.outputLength)
    assert.ok(out instanceof Uint8Array && !Buffer.isBuffer(out), `${t.name}: plain Uint8Array`)
    assert.equal(Buffer.from(out).toString('hex'), t.expected, t.name)
  }
})

test('wotsAddress matches the cross-SDK wallet vectors', () => {
  for (const t of vectors.wallet_generation.tests) {
    assert.equal(kcore.wotsAddress(walletKey(t)), t.expectedAddress, t.name)
  }
})

test('chainsHex and wotsAddress match an independent node:crypto implementation', () => {
  for (let i = 0; i < 20; i++) {
    const key = randomKey()
    const counts = Array.from({ length: 16 }, (_, j) => (j === 0 ? 0 : j === 1 ? 64 : randomBytes(1)[0] % 17))
    assert.equal(kcore.chainsHex(key, counts), referenceChains(key, counts), `chains ${i}`)
    assert.equal(kcore.wotsAddress(key), referenceAddress(key), `address ${i}`)
  }
  const one = randomKey().slice(0, 128)
  assert.equal(kcore.chainsHex(one, [3]), referenceChains(one, [3]), 'a single chain')
})

for (const set of [1024, 768]) {
  test(`ML-KEM-${set} matches @noble/post-quantum`, () => {
    const noble = NOBLE[set]
    for (let i = 0; i < 10; i++) {
      const seed = new Uint8Array(randomBytes(64))
      const coins = new Uint8Array(randomBytes(32))
      const ours = kcore.mlkemKeypair(set, seed)
      const theirs = noble.keygen(seed)
      assert.deepEqual(ours.publicKey, theirs.publicKey, `pk ${i}`)
      assert.deepEqual(ours.secretKey, theirs.secretKey, `sk ${i}`)
      const enc = kcore.mlkemEncaps(set, ours.publicKey, coins)
      const nobleEnc = noble.encapsulate(theirs.publicKey, coins)
      assert.deepEqual(enc.cipherText, nobleEnc.cipherText, `ct ${i}`)
      assert.deepEqual(enc.sharedSecret, nobleEnc.sharedSecret, `ss ${i}`)
      assert.deepEqual(kcore.mlkemDecaps(set, enc.cipherText, ours.secretKey), enc.sharedSecret, `decaps ${i}`)
    }
  })
}

test('invalid arguments throw coded errors', () => {
  const key = 'a'.repeat(2048)
  assertCode(() => kcore.wotsAddress(key.slice(1)), TypeError, 'KCORE_BAD_ARG')
  assertCode(() => kcore.wotsAddress('é'.repeat(2048)), TypeError, 'KCORE_BAD_ARG')
  assertCode(() => kcore.chainsHex(key.slice(0, 128), [65]), Error, 'KCORE_REJECTED')
  assertCode(() => kcore.chainsHex(key.slice(0, 128), [-1]), Error, 'KCORE_REJECTED')
  assertCode(() => kcore.chainsHex(`${'a'.repeat(127)}\0`, [1]), Error, 'KCORE_REJECTED')
  assertCode(() => kcore.chainsHex(key.slice(0, 128), [1.5]), TypeError, 'KCORE_BAD_ARG')
  assertCode(() => kcore.chainsHex(key.slice(0, 127), [1]), TypeError, 'KCORE_BAD_ARG')
  assertCode(() => kcore.mlkemKeypair(512, new Uint8Array(64)), RangeError, 'KCORE_BAD_SET')
  assertCode(() => kcore.mlkemKeypair(1024, new Uint8Array(63)), TypeError, 'KCORE_BAD_ARG')
  assertCode(() => kcore.mlkemEncaps(768, new Uint8Array(1568), new Uint8Array(32)), TypeError, 'KCORE_BAD_ARG')
  assertCode(() => kcore.shake256(new Uint8Array(1), 0), TypeError, 'KCORE_BAD_ARG')
  // A public key whose coefficients are not reduced mod q fails FIPS 203's input check in both
  // implementations.
  const badPk = new Uint8Array(1568).fill(0xff)
  assertCode(() => kcore.mlkemEncaps(1024, badPk, new Uint8Array(32)), Error, 'KCORE_REJECTED')
  assert.throws(() => nobleMlKem1024.encapsulate(badPk, new Uint8Array(32)))
})
