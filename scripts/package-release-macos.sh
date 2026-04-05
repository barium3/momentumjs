#!/bin/sh

set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname "$0")" && pwd)"
ROOT_DIR="$(CDPATH= cd -- "${SCRIPT_DIR}/.." && pwd)"
DIST_DIR="${ROOT_DIR}/dist"
RELEASE_DIR="${DIST_DIR}/momentumjs"
LEGACY_RELEASE_DIR="${DIST_DIR}/momentumjs-macos"
EXTENSION_PAYLOAD_DIR="${RELEASE_DIR}/momentumjs"

if [ "$(uname -s)" != "Darwin" ]; then
  echo "Error: scripts/package-release-macos.sh currently supports macOS only."
  exit 1
fi

PLUGIN_SOURCE_DIR=""
for candidate in \
  "${ROOT_DIR}/Momentum.plugin" \
  "${ROOT_DIR}/build/Debug/Momentum.plugin"
do
  if [ -d "${candidate}/Contents/MacOS" ]; then
    PLUGIN_SOURCE_DIR="${candidate}"
    break
  fi
done

if [ -z "${PLUGIN_SOURCE_DIR}" ]; then
  echo "Error: Could not find a prebuilt Momentum.plugin bundle."
  echo "Build the plugin first, or place a release-ready Momentum.plugin at the repo root."
  exit 1
fi

rm -rf "${RELEASE_DIR}" "${LEGACY_RELEASE_DIR}"
mkdir -p "${RELEASE_DIR}"
mkdir -p "${RELEASE_DIR}/scripts"

rsync -a \
  --exclude '.git' \
  --exclude 'build' \
  --exclude 'dist' \
  --exclude '.DS_Store' \
  --exclude 'install.sh' \
  --exclude 'uninstall.sh' \
  "${ROOT_DIR}/" \
  "${EXTENSION_PAYLOAD_DIR}/"

rsync -a "${PLUGIN_SOURCE_DIR}/" "${RELEASE_DIR}/Momentum.plugin/"

cp "${ROOT_DIR}/install.sh" "${RELEASE_DIR}/install.sh"
cp "${ROOT_DIR}/uninstall.sh" "${RELEASE_DIR}/uninstall.sh"
cp "${ROOT_DIR}/scripts/install.sh" "${RELEASE_DIR}/scripts/install.sh"
cp "${ROOT_DIR}/scripts/uninstall.sh" "${RELEASE_DIR}/scripts/uninstall.sh"

chmod +x \
  "${RELEASE_DIR}/install.sh" \
  "${RELEASE_DIR}/uninstall.sh" \
  "${RELEASE_DIR}/scripts/install.sh" \
  "${RELEASE_DIR}/scripts/uninstall.sh"

echo "Release directory created at: ${RELEASE_DIR}"
echo "Suggested archive name: momentumjs-macos.zip"
