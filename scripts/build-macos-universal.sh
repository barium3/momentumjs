#!/bin/sh

set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname "$0")" && pwd)"
ROOT_DIR="$(CDPATH= cd -- "${SCRIPT_DIR}/.." && pwd)"
DEFAULT_VCPKG_ROOT="${ROOT_DIR}/.local-tools/vcpkg"
VCPKG_ROOT="${VCPKG_ROOT:-${DEFAULT_VCPKG_ROOT}}"

if [ ! -x "${VCPKG_ROOT}/vcpkg" ]; then
  echo "Error: vcpkg is not bootstrapped at ${VCPKG_ROOT}." >&2
  exit 1
fi

export VCPKG_ROOT

sh "${SCRIPT_DIR}/check-ae-plugin-env.sh"

cmake --preset macos-x86_64
cmake --build --preset macos-x86_64-release

cmake --preset macos-arm64
cmake --build --preset macos-arm64-release

case "$(uname -m)" in
  x86_64)
    ctest --preset macos-x86_64-release
    ;;
  arm64)
    ctest --preset macos-arm64-release
    ;;
esac

X86_PLUGIN_DIR="${ROOT_DIR}/build-macos-x86_64/Release/Momentum.plugin" \
ARM64_PLUGIN_DIR="${ROOT_DIR}/build-macos-arm64/Release/Momentum.plugin" \
UNIVERSAL_PLUGIN_DIR="${ROOT_DIR}/build-universal/Release/Momentum.plugin" \
  sh "${SCRIPT_DIR}/merge-ae-plugin-universal.sh"

echo "macOS Universal Release build completed."
