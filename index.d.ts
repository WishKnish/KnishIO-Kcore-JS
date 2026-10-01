/** ML-KEM parameter set: 1024 (default in KnishIO) or 768. */
export type MlKemSet = 1024 | 768

/** Backend that loaded: the Node-API prebuild or the WebAssembly fallback. */
export declare const backend: 'napi' | 'wasm'
/** Absolute path of the loaded kcore.node or kcore.wasm. */
export declare const libraryPath: string
/** Version of the bundled kcore C library. */
export declare const kcoreVersion: '0.1.0'
/** kcore ABI version (1). */
export declare function abiVersion (): number

/** SHAKE256(input) truncated to outLen bytes (1..1048576). */
export declare function shake256 (input: Uint8Array, outLen: number): Uint8Array
/**
 * Advances counts.length WOTS+ chains of 128 hex characters each: chunk i becomes
 * hex(SHAKE256(chunk, 64 bytes)) applied counts[i] times. counts 0..64, 1..64 chains.
 */
export declare function chainsHex (chunks: string, counts: ArrayLike<number>): string
/** WOTS+ address (64 hex characters) of a 2048-hex-character key. */
export declare function wotsAddress (key: string): string

/** Deterministic ML-KEM keypair from a 64-byte seed (d || z). */
export declare function mlkemKeypair (set: MlKemSet, seed: Uint8Array): { publicKey: Uint8Array, secretKey: Uint8Array }
/** ML-KEM encapsulation. `coins` must be 32 fresh random bytes on every call. */
export declare function mlkemEncaps (set: MlKemSet, publicKey: Uint8Array, coins: Uint8Array): { cipherText: Uint8Array, sharedSecret: Uint8Array }
/** ML-KEM decapsulation (implicit rejection: a bad ciphertext yields a pseudo-random secret). */
export declare function mlkemDecaps (set: MlKemSet, cipherText: Uint8Array, secretKey: Uint8Array): Uint8Array

declare const kcore: {
  backend: typeof backend
  libraryPath: typeof libraryPath
  kcoreVersion: typeof kcoreVersion
  abiVersion: typeof abiVersion
  shake256: typeof shake256
  chainsHex: typeof chainsHex
  wotsAddress: typeof wotsAddress
  mlkemKeypair: typeof mlkemKeypair
  mlkemEncaps: typeof mlkemEncaps
  mlkemDecaps: typeof mlkemDecaps
}
export default kcore
