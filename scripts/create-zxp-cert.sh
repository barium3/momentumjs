#!/bin/sh

set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname "$0")" && pwd)"
ROOT_DIR="$(CDPATH= cd -- "${SCRIPT_DIR}/.." && pwd)"
export ROOT_DIR
. "${SCRIPT_DIR}/lib/common.sh"

require_macos
load_local_signing_env

ZXP_SIGN_CMD="$(find_zxp_sign_cmd || true)"
DEFAULT_CERT_DIR="${ROOT_DIR}/.local-signing"
CERT_PATH="${MOMENTUM_ZXP_CERT_PATH:-${DEFAULT_CERT_DIR}/momentumjs-selfsigned.p12}"
CERT_PASSWORD="${MOMENTUM_ZXP_CERT_PASSWORD:-}"
CERT_COUNTRY="${MOMENTUM_ZXP_CERT_COUNTRY:-US}"
CERT_STATE="${MOMENTUM_ZXP_CERT_STATE:-Momentum}"
CERT_ORGANIZATION="${MOMENTUM_ZXP_CERT_ORGANIZATION:-momentumjs}"
CERT_COMMON_NAME="${MOMENTUM_ZXP_CERT_COMMON_NAME:-momentumjs}"
OVERWRITE="${MOMENTUM_ZXP_CERT_OVERWRITE:-0}"

if [ -z "${ZXP_SIGN_CMD}" ]; then
  echo "Error: Could not find ZXPSignCmd. Set MOMENTUM_ZXP_SIGN_CMD or add ZXPSignCmd to PATH." >&2
  exit 1
fi

if [ -z "${CERT_PASSWORD}" ]; then
  echo "Error: MOMENTUM_ZXP_CERT_PASSWORD is required." >&2
  exit 1
fi

if [ -f "${CERT_PATH}" ] && [ "${OVERWRITE}" != "1" ]; then
  echo "Error: Certificate already exists at ${CERT_PATH}." >&2
  echo "Set MOMENTUM_ZXP_CERT_OVERWRITE=1 to replace it." >&2
  exit 1
fi

ensure_dir "$(dirname "${CERT_PATH}")"
rm -f "${CERT_PATH}"

"${ZXP_SIGN_CMD}" -selfSignedCert \
  "${CERT_COUNTRY}" \
  "${CERT_STATE}" \
  "${CERT_ORGANIZATION}" \
  "${CERT_COMMON_NAME}" \
  "${CERT_PASSWORD}" \
  "${CERT_PATH}"

echo "Self-signed ZXP certificate created at: ${CERT_PATH}"
