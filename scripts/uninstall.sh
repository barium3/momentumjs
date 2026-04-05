#!/bin/sh

set -eu

if [ "$(uname -s)" != "Darwin" ]; then
  echo "Error: scripts/uninstall.sh currently supports macOS only."
  exit 1
fi

APP_SUPPORT_DIR="${HOME}/Library/Application Support/Adobe"
CEP_TARGET_DIR="${APP_SUPPORT_DIR}/CEP/extensions/momentumjs"
COMMON_PLUGINS_DIR="${APP_SUPPORT_DIR}/Common/Plug-ins"

remove_if_exists() {
  if [ -e "$1" ]; then
    rm -rf "$1"
    echo "Removed: $1"
  fi
}

remove_if_exists "${CEP_TARGET_DIR}"

if [ -d "${COMMON_PLUGINS_DIR}" ]; then
  remove_if_exists "${COMMON_PLUGINS_DIR}/Momentum"
  find "${COMMON_PLUGINS_DIR}" -maxdepth 2 -type d -name MediaCore 2>/dev/null | while IFS= read -r media_core_dir; do
    remove_if_exists "${media_core_dir}/Momentum"
  done
fi

echo "Momentum uninstall completed."
