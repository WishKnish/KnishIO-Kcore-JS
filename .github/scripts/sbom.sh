#!/usr/bin/env bash
# This repo's CycloneDX SBOM — one definition shared by ci, audit, publish and local runs.
# Usage: bash .github/scripts/sbom.sh [OUT_DIR]   (default sbom-out)
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."
OUT="${1:-sbom-out}"
case "$OUT" in ''|/) echo "SBOM FAIL refusing OUT_DIR '$OUT'" >&2; exit 1 ;; esac
VERSION="$(bash .github/scripts/check-version.sh | sed -n 's/^OK: version is \([^ ]*\).*/\1/p')"
[ -n "$VERSION" ] || { echo "SBOM FAIL could not read the version" >&2; exit 1; }
rm -rf "$OUT"; mkdir -p "$OUT/gen"
# No runtime npm dependencies: the package is the addon/wasm built from pinned KnishIO-Crypto-Core.
python3 .github/scripts/sbom.py --name knishio-kcore-js --version "$VERSION" --type library \
  --components .github/sbom-components.json --out "$OUT"
