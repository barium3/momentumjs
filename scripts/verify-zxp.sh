#!/bin/sh

set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname "$0")" && pwd)"
ROOT_DIR="$(CDPATH= cd -- "${SCRIPT_DIR}/.." && pwd)"
export ROOT_DIR
. "${SCRIPT_DIR}/lib/common.sh"

require_macos
load_local_signing_env

ZXP_SIGN_CMD="$(find_zxp_sign_cmd || true)"
ZXP_PATH="${MOMENTUM_ZXP_OUTPUT:-${ROOT_DIR}/dist/momentumjs.zxp}"
SHOW_CERT_INFO="${MOMENTUM_ZXP_VERIFY_CERT_INFO:-1}"

if [ -z "${ZXP_SIGN_CMD}" ]; then
  echo "Error: Could not find ZXPSignCmd. Set MOMENTUM_ZXP_SIGN_CMD or add ZXPSignCmd to PATH." >&2
  exit 1
fi

if [ ! -f "${ZXP_PATH}" ]; then
  echo "Error: Could not find signed ZXP at ${ZXP_PATH}." >&2
  exit 1
fi

if [ "${SHOW_CERT_INFO}" = "0" ]; then
  "${ZXP_SIGN_CMD}" -verify "${ZXP_PATH}"
else
  "${ZXP_SIGN_CMD}" -verify "${ZXP_PATH}" -certInfo
fi
