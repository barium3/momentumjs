#!/bin/sh

set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname "$0")" && pwd)"
ROOT_DIR="$(CDPATH= cd -- "${SCRIPT_DIR}/.." && pwd)"
export ROOT_DIR
. "${SCRIPT_DIR}/lib/common.sh"

DIST_DIR="${MOMENTUM_DIST_DIR:-${ROOT_DIR}/dist}"
RELEASE_DIR="${DIST_DIR}/momentumjs"
ARCHIVE_PATH="${DIST_DIR}/momentumjs.zip"
WINDOWS_ARTIFACT_DIR="${MOMENTUM_WINDOWS_ARTIFACT_DIR:-${ROOT_DIR}/dist/windows/Release}"

require_macos

PLUGIN_SOURCE_DIR="$(resolve_plugin_source || true)"
EXTENSION_SOURCE_DIR="$(resolve_extension_source || true)"

if [ -z "${PLUGIN_SOURCE_DIR}" ]; then
  echo "Error: Could not find a prebuilt Momentum.plugin bundle."
  echo "Build the plugin first, or place a release-ready Momentum.plugin at the repo root."
  exit 1
fi

if [ -z "${EXTENSION_SOURCE_DIR}" ]; then
  echo "Error: Could not find a Momentum CEP extension payload."
  exit 1
fi

if [ ! -f "${WINDOWS_ARTIFACT_DIR}/Momentum.aex" ]; then
  echo "Error: Could not find the Windows release artifact." >&2
  echo "Expected: ${WINDOWS_ARTIFACT_DIR}/Momentum.aex" >&2
  exit 1
fi

rm -rf "${RELEASE_DIR}"
copy_release_extension_tree "${EXTENSION_SOURCE_DIR}" "${RELEASE_DIR}/extension"
ensure_dir "${RELEASE_DIR}/native/macos/Momentum.plugin"
ensure_dir "${RELEASE_DIR}/native/windows"
rsync -a "${PLUGIN_SOURCE_DIR}/" "${RELEASE_DIR}/native/macos/Momentum.plugin/"
cp "${WINDOWS_ARTIFACT_DIR}/Momentum.aex" "${RELEASE_DIR}/native/windows/Momentum.aex"
for runtime_dll in "${WINDOWS_ARTIFACT_DIR}"/*.dll; do
  if [ -f "${runtime_dll}" ]; then
    cp "${runtime_dll}" "${RELEASE_DIR}/native/windows/"
  fi
done
if [ -f "${WINDOWS_ARTIFACT_DIR}/BUILD-INFO.txt" ]; then
  cp "${WINDOWS_ARTIFACT_DIR}/BUILD-INFO.txt" "${RELEASE_DIR}/native/windows/BUILD-INFO.txt"
fi
copy_release_docs "${RELEASE_DIR}"
copy_release_support_scripts "${RELEASE_DIR}"
create_zip_archive "${RELEASE_DIR}" "${ARCHIVE_PATH}"

echo "Release directory created at: ${RELEASE_DIR}"
echo "Cross-platform unsigned manual-install archive created at: ${ARCHIVE_PATH}"
