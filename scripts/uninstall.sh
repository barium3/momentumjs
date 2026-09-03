#!/bin/sh

set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname "$0")" && pwd)"
ROOT_DIR="$(CDPATH= cd -- "${SCRIPT_DIR}/.." && pwd)"
export ROOT_DIR
. "${SCRIPT_DIR}/lib/common.sh"

require_macos
require_non_root_install

USER_CEP_TARGET_DIR="${APP_SUPPORT_USER_DIR}/CEP/extensions/momentumjs"
COMMON_PLUGINS_DIR="${APP_SUPPORT_USER_DIR}/Common/Plug-ins"

remove_if_exists() {
  if [ -e "$1" ]; then
    rm -rf "$1"
    echo "Removed: $1"
  fi
}

remove_extension_preserving_user "${USER_CEP_TARGET_DIR}"

if [ -d "${COMMON_PLUGINS_DIR}" ]; then
  remove_if_exists "${COMMON_PLUGINS_DIR}/Momentum"
  find "${COMMON_PLUGINS_DIR}" -maxdepth 2 -type d -name MediaCore 2>/dev/null | while IFS= read -r media_core_dir; do
    remove_if_exists "${media_core_dir}/Momentum"
  done
fi

if [ "${MOMENTUM_REMOVE_USER_DATA:-0}" = "1" ]; then
  echo "Momentum uninstall completed, including user workspaces."
else
  echo "Momentum uninstall completed. User workspaces were preserved."
fi
remove_if_exists "${MOMENTUM_UNINSTALL_DIR}"
echo "Unsigned CEP mode was left unchanged because other extensions may use it."
