#!/bin/sh

set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname "$0")" && pwd)"
ROOT_DIR="$(CDPATH= cd -- "${SCRIPT_DIR}/.." && pwd)"

if [ "$(uname -s)" != "Darwin" ]; then
  echo "Error: scripts/install-dev.sh currently supports macOS only."
  exit 1
fi

sh "${ROOT_DIR}/scripts/build-ae-plugin.sh"
sh "${ROOT_DIR}/scripts/install.sh"
