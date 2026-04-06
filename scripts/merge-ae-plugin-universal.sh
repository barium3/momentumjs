#!/bin/sh

set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname "$0")" && pwd)"
ROOT_DIR="$(CDPATH= cd -- "${SCRIPT_DIR}/.." && pwd)"
X86_PLUGIN_DIR="${X86_PLUGIN_DIR:-${ROOT_DIR}/build/Debug/Momentum.plugin}"
ARM64_PLUGIN_DIR="${ARM64_PLUGIN_DIR:-${ROOT_DIR}/build-arm64/Debug/Momentum.plugin}"
UNIVERSAL_PLUGIN_DIR="${UNIVERSAL_PLUGIN_DIR:-${ROOT_DIR}/build-universal/Debug/Momentum.plugin}"

MAIN_BINARY_REL="Contents/MacOS/Momentum"
FRAMEWORKS_REL="Contents/Frameworks"

require_file() {
  if [ ! -f "$1" ]; then
    echo "Error: Missing file: $1" >&2
    exit 1
  fi
}

require_dir() {
  if [ ! -d "$1" ]; then
    echo "Error: Missing directory: $1" >&2
    exit 1
  fi
}

list_frameworks() {
  find "$1" -maxdepth 1 -type f -name '*.dylib' -print | sed 's#^.*/##' | sort
}

require_dir "${X86_PLUGIN_DIR}"
require_dir "${ARM64_PLUGIN_DIR}"
require_file "${X86_PLUGIN_DIR}/${MAIN_BINARY_REL}"
require_file "${ARM64_PLUGIN_DIR}/${MAIN_BINARY_REL}"
require_dir "${X86_PLUGIN_DIR}/${FRAMEWORKS_REL}"
require_dir "${ARM64_PLUGIN_DIR}/${FRAMEWORKS_REL}"

X86_FRAMEWORK_LIST="$(list_frameworks "${X86_PLUGIN_DIR}/${FRAMEWORKS_REL}")"
ARM64_FRAMEWORK_LIST="$(list_frameworks "${ARM64_PLUGIN_DIR}/${FRAMEWORKS_REL}")"

if [ "${X86_FRAMEWORK_LIST}" != "${ARM64_FRAMEWORK_LIST}" ]; then
  echo "Error: x86_64 and arm64 framework sets do not match." >&2
  echo "x86_64 frameworks:" >&2
  printf '%s\n' "${X86_FRAMEWORK_LIST}" >&2
  echo "arm64 frameworks:" >&2
  printf '%s\n' "${ARM64_FRAMEWORK_LIST}" >&2
  exit 1
fi

rm -rf "${UNIVERSAL_PLUGIN_DIR}"
mkdir -p "$(dirname "${UNIVERSAL_PLUGIN_DIR}")"
cp -R "${X86_PLUGIN_DIR}" "${UNIVERSAL_PLUGIN_DIR}"

lipo -create \
  "${X86_PLUGIN_DIR}/${MAIN_BINARY_REL}" \
  "${ARM64_PLUGIN_DIR}/${MAIN_BINARY_REL}" \
  -output "${UNIVERSAL_PLUGIN_DIR}/${MAIN_BINARY_REL}"

printf '%s\n' "${X86_FRAMEWORK_LIST}" | while IFS= read -r dylib_name; do
  if [ -z "${dylib_name}" ]; then
    continue
  fi
  lipo -create \
    "${X86_PLUGIN_DIR}/${FRAMEWORKS_REL}/${dylib_name}" \
    "${ARM64_PLUGIN_DIR}/${FRAMEWORKS_REL}/${dylib_name}" \
    -output "${UNIVERSAL_PLUGIN_DIR}/${FRAMEWORKS_REL}/${dylib_name}"
done

for dylib in "${UNIVERSAL_PLUGIN_DIR}/${FRAMEWORKS_REL}"/*.dylib; do
  if [ -f "${dylib}" ]; then
    codesign --force --sign - "${dylib}" >/dev/null 2>&1
  fi
done

codesign --force --sign - "${UNIVERSAL_PLUGIN_DIR}" >/dev/null 2>&1

echo "Universal plugin created at: ${UNIVERSAL_PLUGIN_DIR}"
