#!/usr/bin/env bash
# build-addon.sh <target>
#
# Builds prebuilds/<target>/kcore.node from src/kcore_napi.c, statically linked against the kcore
# static library that scripts/fetch-kcore.mjs put in vendor/<target>/. Node-API headers come from the
# pinned node-api-headers devDependency.
#   linux-*            zig 0.16.0, the same targets and -mcpu as KnishIO-Crypto-Core's toolchains
#   windows-x64        zig 0.16.0 (x86_64-windows-gnu); no node.exe import library: napi_* resolve at
#                      load from the host process (src/kcore_napi.c), so renamed hosts work
#   darwin-universal   Xcode clang, arm64 + x86_64, macOS >= 11 (macOS hosts only)
# Only the Node-API entry points are exported: kcore.h gives kcore_* default visibility, so the static
# library's symbols are hidden explicitly (src/addon.map on ELF, -exported_symbol on Mach-O).
# Prints "BUILD ok <target> <file>" or "BUILD FAIL <reason>".
set -euo pipefail

fail() { echo "BUILD FAIL $*" >&2; exit 1; }

[ "$#" -eq 1 ] || { echo "usage: build-addon.sh <target>" >&2; exit 2; }
target=$1
cd "$(dirname "${BASH_SOURCE[0]}")/.."

headers=node_modules/node-api-headers
[ -f "$headers/include/node_api.h" ] || fail "node-api-headers is not installed (npm ci --ignore-scripts)"
[ -f "vendor/$target/include/kcore.h" ] || fail "vendor/$target missing (node scripts/fetch-kcore.mjs $target)"

out=prebuilds/$target/kcore.node
rm -rf "prebuilds/$target"
mkdir -p "prebuilds/$target" build
cflags=(-std=c11 -O2 -Wall -Wextra -Werror -fvisibility=hidden -DNAPI_VERSION=8
        -I "$headers/include" -I "vendor/$target/include")

zig_linux() { # <zig target> <mcpu>
    zig cc -target "$1" -mcpu="$2" -shared -fPIC -s -Wl,-z,undefs -Wl,--version-script=src/addon.map \
        "${cflags[@]}" src/kcore_napi.c "vendor/$target/lib/libkcore.a" -o "$out"
}

case "$target" in
linux-x64-gnu) zig_linux x86_64-linux-gnu.2.17 x86_64 ;;
linux-arm64-gnu) zig_linux aarch64-linux-gnu.2.17 cortex_a72 ;;
linux-x64-musl) zig_linux x86_64-linux-musl x86_64 ;;
linux-arm64-musl) zig_linux aarch64-linux-musl cortex_a72 ;;
windows-x64)
    zig cc -target x86_64-windows-gnu -mcpu=x86_64 -shared -s -DKCORE_STATIC "${cflags[@]}" \
        src/kcore_napi.c vendor/windows-x64/lib/libkcore_static.a -o "$out"
    # zig also writes import libraries next to the DLL; the package ships only the .node.
    rm -f "prebuilds/$target"/*.lib "prebuilds/$target"/*.pdb
    ;;
darwin-universal)
    [ "$(uname -s)" = Darwin ] || fail "darwin needs macOS"
    clang -arch arm64 -arch x86_64 -mmacosx-version-min=11.0 -bundle -undefined dynamic_lookup \
        -Wl,-exported_symbol,_napi_register_module_v1 \
        -Wl,-exported_symbol,_node_api_module_get_api_version_v1 \
        "${cflags[@]}" src/kcore_napi.c vendor/darwin-universal/lib/libkcore.a -o "$out"
    archs=$(lipo -archs "$out")
    case " $archs " in *" x86_64 "*) ;; *) fail "darwin slice x86_64 missing ($archs)" ;; esac
    case " $archs " in *" arm64 "*) ;; *) fail "darwin slice arm64 missing ($archs)" ;; esac
    ;;
*) fail "unknown target '$target'" ;;
esac

[ -s "$out" ] || fail "no output for $target"
echo "BUILD ok $target $out"
