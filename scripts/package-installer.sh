#!/bin/sh

set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname "$0")" && pwd)"
ROOT_DIR="$(CDPATH= cd -- "${SCRIPT_DIR}/.." && pwd)"
export ROOT_DIR
. "${SCRIPT_DIR}/lib/common.sh"

require_macos

DIST_DIR="${ROOT_DIR}/dist"
STAGING_DIR="${MOMENTUM_PKG_STAGE_DIR:-${DIST_DIR}/pkg-staging}"
PKG_ROOT="${STAGING_DIR}/root"
PKG_SCRIPTS="${STAGING_DIR}/scripts"
PAYLOAD_ROOT="${PKG_ROOT}/private/tmp/momentumjs-installer"
PAYLOAD_EXTENSION_DIR="${PAYLOAD_ROOT}/extension"
PAYLOAD_PLUGIN_DIR="${PAYLOAD_ROOT}/Momentum.plugin"
PAYLOAD_SCRIPT_DIR="${PAYLOAD_ROOT}/scripts"
ZXP_PATH="${MOMENTUM_ZXP_OUTPUT:-${DIST_DIR}/momentumjs.zxp}"
OUTPUT_PATH="${MOMENTUM_PKG_OUTPUT:-${DIST_DIR}/momentumjs-installer.pkg}"
PKG_IDENTIFIER="${MOMENTUM_PKG_IDENTIFIER:-com.barium3.momentumjs.installer}"

PLUGIN_SOURCE_DIR="$(resolve_plugin_source || true)"
EXTENSION_SOURCE_DIR="$(resolve_extension_source || true)"

if [ -z "${EXTENSION_SOURCE_DIR}" ]; then
  echo "Error: Could not find a Momentum CEP extension payload." >&2
  exit 1
fi

if [ -z "${PLUGIN_SOURCE_DIR}" ]; then
  echo "Error: Could not find a prebuilt Momentum.plugin bundle." >&2
  exit 1
fi

if [ ! -f "${ZXP_PATH}" ]; then
  echo "Error: Could not find signed ZXP at ${ZXP_PATH}." >&2
  echo "Run scripts/package-zxp.sh first." >&2
  exit 1
fi

VERSION="$(read_extension_version "${EXTENSION_SOURCE_DIR}" || true)"
if [ -z "${VERSION}" ]; then
  echo "Error: Could not determine extension version from CSXS/manifest.xml." >&2
  exit 1
fi

rm -rf "${STAGING_DIR}"
ensure_dir "${PAYLOAD_EXTENSION_DIR}"
ensure_dir "${PAYLOAD_SCRIPT_DIR}/lib"
ensure_dir "${PKG_SCRIPTS}"

if command -v ditto >/dev/null 2>&1; then
  ditto -x -k "${ZXP_PATH}" "${PAYLOAD_EXTENSION_DIR}"
else
  unzip -q "${ZXP_PATH}" -d "${PAYLOAD_EXTENSION_DIR}"
fi

rsync -a "${PLUGIN_SOURCE_DIR}/" "${PAYLOAD_PLUGIN_DIR}/"
cp "${ROOT_DIR}/scripts/install.sh" "${PAYLOAD_SCRIPT_DIR}/install.sh"
cp "${ROOT_DIR}/scripts/lib/common.sh" "${PAYLOAD_SCRIPT_DIR}/lib/common.sh"
cp "${ROOT_DIR}/scripts/pkg/postinstall" "${PKG_SCRIPTS}/postinstall"
chmod +x "${PAYLOAD_SCRIPT_DIR}/install.sh" "${PKG_SCRIPTS}/postinstall"

rm -f "${OUTPUT_PATH}"
pkgbuild \
  --identifier "${PKG_IDENTIFIER}" \
  --version "${VERSION}" \
  --root "${PKG_ROOT}" \
  --scripts "${PKG_SCRIPTS}" \
  "${OUTPUT_PATH}"

echo "Installer package created at: ${OUTPUT_PATH}"
