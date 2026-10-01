'use strict'
// @wishknish/knishio-kcore: Node binding of kcore (KnishIO-Crypto-Core 0.1.0).
//
// Two backends with one internal interface and one set of error codes:
//   napi  prebuilds/<target>/kcore.node, the C library statically linked into a Node-API addon
//   wasm  kcore.wasm (no imports), instantiated synchronously; used when no prebuild loads
// KNISHIO_KCORE_BACKEND = auto (napi, then wasm) | napi | wasm, read once at load. When nothing loads,
// requiring this module throws, so an optional dependent can treat that as "not available".
//
// Errors carry `code`: KCORE_BAD_ARG (TypeError: type or length), KCORE_BAD_SET (RangeError: ML-KEM
// set other than 1024/768), KCORE_REJECTED (Error: kcore returned -1).
const fs = require('node:fs')
const path = require('node:path')

const ABI_VERSION = 1
const KCORE_VERSION = '0.1.0'
const SETS = {
  1024: { pk: 1568, sk: 3168, ct: 1568 },
  768: { pk: 1184, sk: 2400, ct: 1088 }
}
const SEED = 64
const COINS = 32
const SS = 32

function codedError (Ctor, code, message) {
  const err = new Ctor(message)
  err.code = code
  return err
}
const badArg = (message) => codedError(TypeError, 'KCORE_BAD_ARG', message)
const badSet = () => codedError(RangeError, 'KCORE_BAD_SET', 'parameter set must be 1024 or 768')
const rejected = (fn) => codedError(Error, 'KCORE_REJECTED', `${fn} rejected its arguments`)

function napiTarget () {
  const { platform, arch } = process
  if (arch !== 'x64' && arch !== 'arm64') return null
  if (platform === 'darwin') return 'darwin-universal'
  if (platform === 'win32') return arch === 'x64' ? 'windows-x64' : null
  if (platform === 'linux') {
    const glibc = process.report.getReport().header.glibcVersionRuntime
    return `linux-${arch}-${glibc ? 'gnu' : 'musl'}`
  }
  return null
}

function loadNapi () {
  const target = napiTarget()
  if (target === null) throw new Error(`no prebuild for ${process.platform}-${process.arch}`)
  const file = path.join(__dirname, 'prebuilds', target, 'kcore.node')
  const addon = require(file)
  if (addon.abiVersion() !== ABI_VERSION) throw new Error(`ABI version ${addon.abiVersion()}, expected ${ABI_VERSION}`)
  return { name: 'napi', file, impl: addon }
}

function loadWasm () {
  const file = path.join(__dirname, 'kcore.wasm')
  const instance = new WebAssembly.Instance(new WebAssembly.Module(fs.readFileSync(file)), {})
  const ex = instance.exports
  ex._initialize()
  if (ex.kcore_abi_version() !== ABI_VERSION) throw new Error(`ABI version ${ex.kcore_abi_version()}, expected ${ABI_VERSION}`)

  // Copies `inputs` into fresh WASM regions, adds zeroed regions of `outputs` bytes, runs
  // fn(pointers) and returns its rc plus copies of every region (inputs first; kcore_chains_hex works
  // in place on its input). Every region is zero-filled before it is freed, so secret keys, seeds,
  // coins and shared secrets do not linger in the instance's memory.
  function call (inputs, outputs, fn) {
    const sizes = [...inputs.map((b) => b.length), ...outputs]
    const ptrs = []
    try {
      for (const n of sizes) {
        const p = ex.malloc(Math.max(n, 1))
        if (p === 0) throw new Error('kcore.wasm: out of memory')
        ptrs.push(p)
      }
      let mem = new Uint8Array(ex.memory.buffer)
      inputs.forEach((b, i) => mem.set(b, ptrs[i]))
      outputs.forEach((n, j) => mem.fill(0, ptrs[inputs.length + j], ptrs[inputs.length + j] + n))
      const rc = fn(ptrs)
      mem = new Uint8Array(ex.memory.buffer)
      return { rc, regions: sizes.map((n, i) => mem.slice(ptrs[i], ptrs[i] + n)) }
    } finally {
      const mem = new Uint8Array(ex.memory.buffer)
      ptrs.forEach((p, i) => { mem.fill(0, p, p + sizes[i]); ex.free(p) })
    }
  }

  const impl = {
    abiVersion: () => ex.kcore_abi_version(),
    shake256 (input, outLen) {
      const { rc, regions } = call([input], [outLen], ([i, o]) => ex.kcore_shake256(i, input.length, o, outLen))
      if (rc !== 0) throw rejected('kcore_shake256')
      return regions[1]
    },
    chainsHex (chunks, counts) {
      const countBytes = new Uint8Array(counts.buffer, counts.byteOffset, counts.byteLength)
      const { rc, regions } = call([chunks, countBytes], [], ([c, k]) => ex.kcore_chains_hex(c, k, counts.length, 4))
      if (rc !== 0) throw rejected('kcore_chains_hex')
      return regions[0]
    },
    wotsAddress (key) {
      const { rc, regions } = call([key], [64], ([k, o]) => ex.kcore_wots_address(k, o))
      if (rc !== 0) throw rejected('kcore_wots_address')
      return regions[1]
    },
    mlkemKeypair (set, seed) {
      const m = SETS[set]
      const fn = set === 1024 ? ex.kcore_mlkem1024_keypair : ex.kcore_mlkem768_keypair
      const { rc, regions } = call([seed], [m.pk, m.sk], ([s, pk, sk]) => fn(s, pk, sk))
      if (rc !== 0) throw rejected('kcore_mlkem_keypair')
      return regions.slice(1)
    },
    mlkemEncaps (set, pk, coins) {
      const m = SETS[set]
      const fn = set === 1024 ? ex.kcore_mlkem1024_encaps : ex.kcore_mlkem768_encaps
      const { rc, regions } = call([pk, coins], [m.ct, SS], ([p, c, ct, ss]) => fn(p, c, ct, ss))
      if (rc !== 0) throw rejected('kcore_mlkem_encaps')
      return regions.slice(2)
    },
    mlkemDecaps (set, ct, sk) {
      const fn = set === 1024 ? ex.kcore_mlkem1024_decaps : ex.kcore_mlkem768_decaps
      const { rc, regions } = call([ct, sk], [SS], ([c, s, ss]) => fn(c, s, ss))
      if (rc !== 0) throw rejected('kcore_mlkem_decaps')
      return regions[2]
    }
  }

  return { name: 'wasm', file, impl }
}

function selectBackend () {
  const choice = (process.env.KNISHIO_KCORE_BACKEND || 'auto').toLowerCase()
  if (!['auto', 'napi', 'wasm'].includes(choice)) {
    throw new Error(`KNISHIO_KCORE_BACKEND must be auto, napi or wasm, got '${choice}'`)
  }
  const reasons = []
  for (const [name, load] of [['napi', loadNapi], ['wasm', loadWasm]]) {
    if (choice !== 'auto' && choice !== name) continue
    try {
      return load()
    } catch (e) {
      reasons.push(`${name}: ${e && e.message}`)
    }
  }
  throw new Error(`@wishknish/knishio-kcore: no usable backend (${reasons.join('; ')})`)
}

const backend = selectBackend()
const impl = backend.impl

function u8 (value, name, length) {
  if (!(value instanceof Uint8Array)) throw badArg(`${name} must be a Uint8Array`)
  if (length !== undefined && value.length !== length) throw badArg(`${name} must be ${length} bytes`)
  return value
}

function ascii (value, name) {
  if (typeof value !== 'string' || !/^[\x00-\x7f]*$/.test(value)) throw badArg(`${name} must be an ASCII string`)
  return Buffer.from(value, 'latin1')
}

function view (b) {
  return new Uint8Array(b.buffer, b.byteOffset, b.byteLength)
}

function mlkemSet (set) {
  const m = SETS[set]
  if (m === undefined) throw badSet()
  return m
}

function shake256 (input, outLen) {
  u8(input, 'input')
  if (!Number.isInteger(outLen) || outLen < 1 || outLen > 1048576) throw badArg('outLen must be an integer in 1..1048576')
  return view(impl.shake256(input, outLen))
}

function chainsHex (chunks, counts) {
  const bytes = ascii(chunks, 'chunks')
  if (counts === null || typeof counts !== 'object' || typeof counts.length !== 'number') {
    throw badArg('counts must be an array of integers')
  }
  const list = Array.from(counts)
  if (!list.every(Number.isInteger)) throw badArg('counts must be integers')
  if (list.length < 1 || list.length > 64 || bytes.length !== 128 * list.length) {
    throw badArg('chunks must hold 128 characters per count (1..64 chains)')
  }
  return Buffer.from(impl.chainsHex(bytes, Int32Array.from(list))).toString('latin1')
}

function wotsAddress (key) {
  const bytes = ascii(key, 'key')
  if (bytes.length !== 2048) throw badArg('key must be 2048 hex characters')
  return Buffer.from(impl.wotsAddress(bytes)).toString('latin1')
}

function mlkemKeypair (set, seed) {
  mlkemSet(set)
  u8(seed, 'seed', SEED)
  const [pk, sk] = impl.mlkemKeypair(set, seed)
  return { publicKey: view(pk), secretKey: view(sk) }
}

function mlkemEncaps (set, publicKey, coins) {
  const m = mlkemSet(set)
  u8(publicKey, 'publicKey', m.pk)
  u8(coins, 'coins', COINS)
  const [ct, ss] = impl.mlkemEncaps(set, publicKey, coins)
  return { cipherText: view(ct), sharedSecret: view(ss) }
}

function mlkemDecaps (set, cipherText, secretKey) {
  const m = mlkemSet(set)
  u8(cipherText, 'cipherText', m.ct)
  u8(secretKey, 'secretKey', m.sk)
  return view(impl.mlkemDecaps(set, cipherText, secretKey))
}

module.exports = {
  backend: backend.name,
  libraryPath: backend.file,
  kcoreVersion: KCORE_VERSION,
  abiVersion: () => impl.abiVersion(),
  shake256,
  chainsHex,
  wotsAddress,
  mlkemKeypair,
  mlkemEncaps,
  mlkemDecaps
}
