# Changelog

All notable changes to `@wishknish/knishio-kcore` are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] — 2026-09-30

### Added

- Node binding of kcore 0.1.0 (KnishIO-Crypto-Core): `shake256`, `chainsHex`, `wotsAddress`, and
  `mlkemKeypair` / `mlkemEncaps` / `mlkemDecaps` for ML-KEM-1024 and ML-KEM-768, plus `backend`,
  `libraryPath`, `kcoreVersion` and `abiVersion()`. Byte results are plain `Uint8Array`s; errors
  carry `KCORE_BAD_ARG`, `KCORE_BAD_SET` or `KCORE_REJECTED`.
- Node-API prebuilds with kcore statically linked, for linux-x64-gnu and linux-arm64-gnu (glibc
  ≥ 2.17), linux-x64-musl, linux-arm64-musl, darwin-universal (macOS ≥ 11) and windows-x64; built
  from the sha256-pinned kcore 0.1.0 Release packages, exporting only the Node-API entry points.
- `kcore.wasm` fallback, instantiated synchronously, used where no prebuild loads.
  `KNISHIO_KCORE_BACKEND` = `auto` | `napi` | `wasm` selects the backend.
- CommonJS and ESM entry points and TypeScript declarations. No dependencies, no install scripts.
  mlkem-native's license text ships as `LICENSE-mlkem-native`.

[0.1.0]: https://github.com/WishKnish/KnishIO-Kcore-JS/releases/tag/0.1.0
