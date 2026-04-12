#!/bin/sh

set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname "$0")" && pwd)"
ROOT_DIR="$(CDPATH= cd -- "${SCRIPT_DIR}/.." && pwd)"
export ROOT_DIR
. "${SCRIPT_DIR}/lib/common.sh"

require_macos
load_local_signing_env

ZXP_SIGN_CMD="$(find_zxp_sign_cmd || true)"
EXTENSION_SOURCE_DIR="$(resolve_extension_source || true)"
DEFAULT_CERT_PATH="${ROOT_DIR}/.local-signing/momentumjs-selfsigned.p12"
CERT_PATH="${MOMENTUM_ZXP_CERT_PATH:-${DEFAULT_CERT_PATH}}"
CERT_PASSWORD="${MOMENTUM_ZXP_CERT_PASSWORD:-}"
TIMESTAMP_URL="${MOMENTUM_ZXP_TIMESTAMP_URL:-}"
STAGE_DIR="${MOMENTUM_ZXP_STAGE_DIR:-${ROOT_DIR}/dist/zxp-staging/momentumjs}"
OUTPUT_PATH="${MOMENTUM_ZXP_OUTPUT:-${ROOT_DIR}/dist/momentumjs.zxp}"

if [ -z "${ZXP_SIGN_CMD}" ]; then
  echo "Error: Could not find ZXPSignCmd. Set MOMENTUM_ZXP_SIGN_CMD or add ZXPSignCmd to PATH." >&2
  exit 1
fi

if [ -z "${EXTENSION_SOURCE_DIR}" ]; then
  echo "Error: Could not find a Momentum CEP extension payload." >&2
  exit 1
fi

if [ -z "${CERT_PATH}" ] || [ ! -f "${CERT_PATH}" ]; then
  echo "Error: Could not find a .p12 certificate at ${CERT_PATH}." >&2
  echo "Set MOMENTUM_ZXP_CERT_PATH or generate one with scripts/create-zxp-cert.sh." >&2
  exit 1
fi

if [ -z "${CERT_PASSWORD}" ]; then
  echo "Error: MOMENTUM_ZXP_CERT_PASSWORD is required." >&2
  exit 1
fi

rm -rf "${STAGE_DIR}"
copy_zxp_extension_tree "${EXTENSION_SOURCE_DIR}" "${STAGE_DIR}"
ensure_dir "$(dirname "${OUTPUT_PATH}")"
rm -f "${OUTPUT_PATH}"

if [ -n "${TIMESTAMP_URL}" ]; then
  "${ZXP_SIGN_CMD}" -sign "${STAGE_DIR}" "${OUTPUT_PATH}" "${CERT_PATH}" "${CERT_PASSWORD}" -tsa "${TIMESTAMP_URL}"
else
  "${ZXP_SIGN_CMD}" -sign "${STAGE_DIR}" "${OUTPUT_PATH}" "${CERT_PATH}" "${CERT_PASSWORD}"
fi

echo "Signed ZXP created at: ${OUTPUT_PATH}"
echo "Staging payload kept at: ${STAGE_DIR}"
