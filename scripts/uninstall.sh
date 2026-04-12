#!/bin/sh

set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname "$0")" && pwd)"
ROOT_DIR="$(CDPATH= cd -- "${SCRIPT_DIR}/.." && pwd)"
export ROOT_DIR
. "${SCRIPT_DIR}/lib/common.sh"

require_macos

USER_CEP_TARGET_DIR="${APP_SUPPORT_USER_DIR}/CEP/extensions/momentumjs"
SYSTEM_CEP_TARGET_DIR="${SYSTEM_CEP_EXTENSIONS_DIR}/momentumjs"
COMMON_PLUGINS_DIR="${APP_SUPPORT_USER_DIR}/Common/Plug-ins"
CEP_SCOPE="${MOMENTUM_CEP_SCOPE:-user}"

remove_if_exists() {
  if [ -e "$1" ]; then
    rm -rf "$1"
    echo "Removed: $1"
  fi
}

case "${CEP_SCOPE}" in
  user)
    remove_if_exists "${USER_CEP_TARGET_DIR}"
    ;;
  system)
    remove_if_exists "${SYSTEM_CEP_TARGET_DIR}"
    ;;
  all)
    remove_if_exists "${USER_CEP_TARGET_DIR}"
    remove_if_exists "${SYSTEM_CEP_TARGET_DIR}"
    ;;
  *)
    echo "Error: Unsupported MOMENTUM_CEP_SCOPE='${CEP_SCOPE}'. Use 'user', 'system', or 'all'." >&2
    exit 1
    ;;
esac

if [ -d "${COMMON_PLUGINS_DIR}" ]; then
  remove_if_exists "${COMMON_PLUGINS_DIR}/Momentum"
  find "${COMMON_PLUGINS_DIR}" -maxdepth 2 -type d -name MediaCore 2>/dev/null | while IFS= read -r media_core_dir; do
    remove_if_exists "${media_core_dir}/Momentum"
  done
fi

echo "Momentum uninstall completed."
