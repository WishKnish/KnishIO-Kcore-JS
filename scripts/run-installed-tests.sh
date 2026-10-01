#!/bin/sh
# run-installed-tests.sh <tgz> <expect-backend>
#
# Installs the packed npm tarball into a fresh directory (with @noble/post-quantum for the ML-KEM
# references; no lifecycle scripts) and runs test/kcore.test.mjs against the INSTALLED package, so
# the result covers exactly what npm would deliver. KNISHIO_KCORE_BACKEND passes through from the
# caller; KNISHIO_KCORE_EXPECT_BACKEND is set to <expect-backend>. POSIX sh: runs on Alpine too, and on
# Windows runners under Git Bash (npm there needs Windows-style paths; cygpath converts).
set -eu

if [ "$#" -ne 2 ]; then
    echo "usage: run-installed-tests.sh <tgz> <expect-backend>" >&2
    exit 2
fi
here=$(cd "$(dirname "$0")/.." && pwd)
case "$1" in /*) tgz=$1 ;; *) tgz=$(pwd)/$1 ;; esac
base=${RUNNER_TEMP:-$HOME/knishio-wave}
if command -v cygpath > /dev/null 2>&1; then
    base=$(cygpath -u "$base")
    tgz=$(cygpath -w "$tgz")
fi
dir=$base/kcore-pkg-test
rm -rf "$dir"
mkdir -p "$dir"
cp -R "$here/test" "$dir/test"
cd "$dir"
npm init -y > /dev/null
npm install "$tgz" @noble/post-quantum@0.7.1 --ignore-scripts --no-audit --no-fund > /dev/null
echo "node $(node --version) on $(uname -sm)"
KNISHIO_KCORE_EXPECT_BACKEND=$2 node --test test/kcore.test.mjs
