# @wishknish/knishio-kcore

Node binding of **kcore** ([KnishIO-Crypto-Core](https://github.com/WishKnish/KnishIO-Crypto-Core) 0.1.0), the shared C crypto core of the KnishIO SDKs: SHAKE256, WOTS+ chains and the WOTS+ address, and ML-KEM-1024 / ML-KEM-768 (FIPS 203, on mlkem-native v1.2.0).

The KnishIO JavaScript and TypeScript SDKs list this package as an optional dependency and use it when it loads; without it they run their pure-JS paths with byte-identical results.

## Backends

| backend | what loads | when |
|---|---|---|
| `napi` | `prebuilds/<target>/kcore.node`, kcore statically linked into a Node-API addon | linux-x64-gnu, linux-arm64-gnu (glibc ≥ 2.17), linux-x64-musl, linux-arm64-musl, darwin-universal (macOS ≥ 11, arm64 + x86_64), windows-x64 |
| `wasm` | `kcore.wasm` (no imports), instantiated synchronously | any other platform, or when the prebuild fails to load |

`KNISHIO_KCORE_BACKEND` = `auto` (default: `napi`, then `wasm`), `napi` or `wasm`, read once at load. If no backend loads, `require('@wishknish/knishio-kcore')` throws. Node ≥ 20. The package has no dependencies and no install scripts.

## API

```js
const kcore = require('@wishknish/knishio-kcore') // or: import kcore from '@wishknish/knishio-kcore'
```

| export | |
|---|---|
| `backend`, `libraryPath`, `kcoreVersion`, `abiVersion()` | what loaded; kcore `0.1.0`, ABI `1` |
| `shake256(input: Uint8Array, outLen: number): Uint8Array` | SHAKE256, `outLen` 1..1048576 bytes |
| `chainsHex(chunks: string, counts: number[]): string` | advances `counts.length` WOTS+ chains of 128 hex characters each, `counts[i]` steps (0..64) of `hex(SHAKE256(chunk, 64 bytes))` |
| `wotsAddress(key: string): string` | WOTS+ address (64 hex) of a 2048-hex key |
| `mlkemKeypair(set, seed)` → `{ publicKey, secretKey }` | deterministic keypair from a 64-byte seed |
| `mlkemEncaps(set, publicKey, coins)` → `{ cipherText, sharedSecret }` | **`coins` must be 32 fresh random bytes on every call**: reusing them against one key repeats the ciphertext and the shared secret |
| `mlkemDecaps(set, cipherText, secretKey)` → `Uint8Array` | 32-byte shared secret |

`set` is `1024` or `768`. Byte results are plain `Uint8Array`s. Errors carry a `code`: `KCORE_BAD_ARG` (TypeError: type or length), `KCORE_BAD_SET` (RangeError), `KCORE_REJECTED` (kcore rejected the input: a count outside 0..64, a NUL byte, a public key failing the FIPS 203 check).

## Building from source

```sh
npm ci --ignore-scripts
node scripts/fetch-kcore.mjs all          # sha256-pinned kcore Release packages -> vendor/, kcore.wasm
bash scripts/build-addon.sh <target>      # zig 0.16.0 (linux-*, windows-x64) or Xcode clang (darwin-universal)
npm test                                  # KNISHIO_KCORE_BACKEND=wasm npm test for the fallback
```

## License

GPL-3.0-or-later, as kcore (`LICENSE`). The binaries also contain mlkem-native v1.2.0, whose license
text ships as `LICENSE-mlkem-native` (copied from the pinned submodule in the kcore 0.1.0 source
release).
