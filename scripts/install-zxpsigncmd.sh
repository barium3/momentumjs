#!/bin/sh

set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname "$0")" && pwd)"
ROOT_DIR="$(CDPATH= cd -- "${SCRIPT_DIR}/.." && pwd)"

ZXP_SIGN_VERSION="${MOMENTUM_ZXP_SIGN_VERSION:-4.1.3}"
INSTALL_DIR="${MOMENTUM_ZXP_SIGN_INSTALL_DIR:-${ROOT_DIR}/.local-tools/ZXPSignCMD/${ZXP_SIGN_VERSION}/macOS}"
TARGET_PATH="${INSTALL_DIR}/ZXPSignCmd"

if ! command -v curl >/dev/null 2>&1; then
  echo "Error: curl is required." >&2
  exit 1
fi

mkdir -p "${INSTALL_DIR}"
rm -f "${TARGET_PATH}"

download_zxpsigncmd() {
  for url in \
    "${MOMENTUM_ZXP_SIGN_URL:-}" \
    "https://github.com/Adobe-CEP/CEP-Resources/raw/master/ZXPSignCMD/${ZXP_SIGN_VERSION}/macOS/ZXPSignCmd" \
    "https://raw.githubusercontent.com/Adobe-CEP/CEP-Resources/master/ZXPSignCMD/${ZXP_SIGN_VERSION}/macOS/ZXPSignCmd"
  do
    if [ -z "${url}" ]; then
      continue
    fi

    if curl -fL --connect-timeout 10 --max-time 90 "${url}" -o "${TARGET_PATH}"; then
      return 0
    fi
  done

  return 1
}

if ! download_zxpsigncmd; then
  echo "Error: Failed to download ZXPSignCmd from the official Adobe CEP repository." >&2
  exit 1
fi

chmod +x "${TARGET_PATH}"

echo "ZXPSignCmd installed at: ${TARGET_PATH}"
