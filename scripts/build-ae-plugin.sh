#!/bin/sh

set -eu

ROOT_DIR="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
BUILD_DIR="${ROOT_DIR}/build"
PLUGIN_DIR="${BUILD_DIR}/Debug/Momentum.plugin"
PLUGIN_BINARY="${PLUGIN_DIR}/Contents/MacOS/Momentum"
FRAMEWORKS_DIR="${PLUGIN_DIR}/Contents/Frameworks"
RESOURCE_DIR="${PLUGIN_DIR}/Contents/Resources"
RESOURCE_FILE="${RESOURCE_DIR}/Momentum.rsrc"
PIPL_FILE="${ROOT_DIR}/src/plugin/MomentumPiPL.r"
SEEN_FILE=""

cleanup() {
  if [ -n "${SEEN_FILE}" ] && [ -f "${SEEN_FILE}" ]; then
    rm -f "${SEEN_FILE}"
  fi
}

trap cleanup EXIT

is_bundle_dependency() {
  case "$1" in
    /usr/local/opt/*|/opt/homebrew/opt/*|/usr/local/Cellar/*|/opt/homebrew/Cellar/*)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

list_dependencies() {
  otool -L "$1" | tail -n +2 | awk '{ print $1 }'
}

has_seen_dependency() {
  [ -n "${SEEN_FILE}" ] && grep -Fqx "$1" "${SEEN_FILE}"
}

mark_seen_dependency() {
  printf '%s\n' "$1" >> "${SEEN_FILE}"
}

bundle_dependency_tree() {
  target="$1"
  for dep in $(list_dependencies "${target}"); do
    if ! is_bundle_dependency "${dep}"; then
      continue
    fi
    if has_seen_dependency "${dep}"; then
      continue
    fi
    mark_seen_dependency "${dep}"
    cp -Lf "${dep}" "${FRAMEWORKS_DIR}/$(basename "${dep}")"
    bundle_dependency_tree "${dep}"
  done
}

rewrite_plugin_dependency_paths() {
  for dep in $(list_dependencies "${PLUGIN_BINARY}"); do
    if ! is_bundle_dependency "${dep}"; then
      continue
    fi
    install_name_tool -change "${dep}" "@loader_path/../Frameworks/$(basename "${dep}")" "${PLUGIN_BINARY}"
  done
}

rewrite_framework_dependency_paths() {
  for dylib in "${FRAMEWORKS_DIR}"/*.dylib; do
    if [ ! -f "${dylib}" ]; then
      continue
    fi
    install_name_tool -id "@loader_path/$(basename "${dylib}")" "${dylib}"
    for dep in $(list_dependencies "${dylib}"); do
      if ! is_bundle_dependency "${dep}"; then
        continue
      fi
      install_name_tool -change "${dep}" "@loader_path/$(basename "${dep}")" "${dylib}"
    done
  done
}

sh "${ROOT_DIR}/scripts/check-ae-plugin-env.sh"

rm -rf "${FRAMEWORKS_DIR}"

cmake -S "${ROOT_DIR}" -B "${BUILD_DIR}" -G Xcode
cmake --build "${BUILD_DIR}" --config Debug

mkdir -p "${RESOURCE_DIR}"
mkdir -p "${FRAMEWORKS_DIR}"
rm -f "${FRAMEWORKS_DIR}"/*.dylib

SEEN_FILE="$(mktemp)"
bundle_dependency_tree "${PLUGIN_BINARY}"
rewrite_plugin_dependency_paths
rewrite_framework_dependency_paths

for dylib in "${FRAMEWORKS_DIR}"/*.dylib; do
  if [ -f "${dylib}" ]; then
    codesign --force --sign - "${dylib}" >/dev/null 2>&1
  fi
done

xcrun Rez -useDF -d __MACH__ \
  -i "${AE_SDK_ROOT}/Examples/Headers" \
  -i "${AE_SDK_ROOT}/Examples/Util" \
  -i "${AE_SDK_ROOT}/Examples/Resources" \
  -o "${RESOURCE_FILE}" \
  "${PIPL_FILE}"

codesign --force --sign - "${PLUGIN_DIR}" >/dev/null 2>&1

echo "Build completed. Check ${BUILD_DIR} for the plugin bundle."
