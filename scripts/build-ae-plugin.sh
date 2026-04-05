#!/bin/sh

set -eu

ROOT_DIR="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
BUILD_DIR="${ROOT_DIR}/build"
PLUGIN_DIR="${BUILD_DIR}/Debug/Momentum.plugin"
RESOURCE_DIR="${PLUGIN_DIR}/Contents/Resources"
RESOURCE_FILE="${RESOURCE_DIR}/Momentum.rsrc"
PIPL_FILE="${ROOT_DIR}/src/plugin/MomentumPiPL.r"

sh "${ROOT_DIR}/scripts/check-ae-plugin-env.sh"

cmake -S "${ROOT_DIR}" -B "${BUILD_DIR}" -G Xcode
cmake --build "${BUILD_DIR}" --config Debug

mkdir -p "${RESOURCE_DIR}"

xcrun Rez -useDF -d __MACH__ \
  -i "${AE_SDK_ROOT}/Examples/Headers" \
  -i "${AE_SDK_ROOT}/Examples/Util" \
  -i "${AE_SDK_ROOT}/Examples/Resources" \
  -o "${RESOURCE_FILE}" \
  "${PIPL_FILE}"

codesign --force --sign - "${PLUGIN_DIR}" >/dev/null 2>&1

echo "Build completed. Check ${BUILD_DIR} for the plugin bundle."
