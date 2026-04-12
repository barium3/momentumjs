#!/bin/sh

set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname "$0")" && pwd)"
ROOT_DIR="$(CDPATH= cd -- "${SCRIPT_DIR}/.." && pwd)"
export ROOT_DIR
. "${SCRIPT_DIR}/lib/common.sh"

DIST_DIR="${ROOT_DIR}/dist"
RELEASE_DIR="${DIST_DIR}/momentumjs"
ARCHIVE_PATH="${DIST_DIR}/momentumjs.zip"

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

rm -rf "${RELEASE_DIR}"
copy_release_extension_tree "${EXTENSION_SOURCE_DIR}" "${RELEASE_DIR}"
rsync -a "${PLUGIN_SOURCE_DIR}/" "${RELEASE_DIR}/Momentum.plugin/"
copy_release_docs "${RELEASE_DIR}"
copy_release_support_scripts "${RELEASE_DIR}"
create_zip_archive "${RELEASE_DIR}" "${ARCHIVE_PATH}"

echo "Release directory created at: ${RELEASE_DIR}"
echo "Release archive created at: ${ARCHIVE_PATH}"
