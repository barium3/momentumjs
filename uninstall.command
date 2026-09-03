#!/bin/sh

set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname "$0")" && pwd)"
TEMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/momentum-uninstall.XXXXXX")"
trap 'rm -rf "${TEMP_DIR}"' EXIT HUP INT TERM

mkdir -p "${TEMP_DIR}/scripts/lib"
cp "${SCRIPT_DIR}/scripts/uninstall.sh" "${TEMP_DIR}/scripts/uninstall.sh"
cp "${SCRIPT_DIR}/scripts/lib/common.sh" "${TEMP_DIR}/scripts/lib/common.sh"

sh "${TEMP_DIR}/scripts/uninstall.sh"
