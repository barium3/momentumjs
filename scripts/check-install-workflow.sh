#!/bin/sh

set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname "$0")" && pwd)"
ROOT_DIR="$(CDPATH= cd -- "${SCRIPT_DIR}/.." && pwd)"
export ROOT_DIR
. "${SCRIPT_DIR}/lib/common.sh"

TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/momentum-install-check.XXXXXX")"
trap 'rm -rf "${TEST_ROOT}"' EXIT HUP INT TERM

SOURCE_DIR="${TEST_ROOT}/source"
TARGET_DIR="${TEST_ROOT}/target"

mkdir -p \
  "${SOURCE_DIR}/CSXS" \
  "${SOURCE_DIR}/user/examples" \
  "${TARGET_DIR}/user/examples"

printf '%s\n' '<manifest />' > "${SOURCE_DIR}/CSXS/manifest.xml"
printf '%s\n' 'new application file' > "${SOURCE_DIR}/index.html"
printf '%s\n' 'bundled example' > "${SOURCE_DIR}/user/examples/example.js"
printf '%s\n' 'stale application file' > "${TARGET_DIR}/stale.js"
printf '%s\n' 'user sketch' > "${TARGET_DIR}/user/sketch.js"
printf '%s\n' 'user-edited example' > "${TARGET_DIR}/user/examples/example.js"

copy_runtime_extension_tree "${SOURCE_DIR}" "${TARGET_DIR}"

test -f "${TARGET_DIR}/index.html"
test ! -e "${TARGET_DIR}/stale.js"
test "$(sed -n '1p' "${TARGET_DIR}/user/sketch.js")" = "user sketch"
test "$(sed -n '1p' "${TARGET_DIR}/user/examples/example.js")" = "user-edited example"

printf '%s\n' 'second bundled example' > "${SOURCE_DIR}/user/examples/second.js"
copy_runtime_extension_tree "${SOURCE_DIR}" "${TARGET_DIR}"
test -f "${TARGET_DIR}/user/examples/second.js"

remove_extension_preserving_user "${TARGET_DIR}"
test -d "${TARGET_DIR}/user"
test -f "${TARGET_DIR}/user/sketch.js"
test ! -e "${TARGET_DIR}/index.html"
test ! -e "${TARGET_DIR}/CSXS"

MOMENTUM_REMOVE_USER_DATA=1 remove_extension_preserving_user "${TARGET_DIR}"
test ! -e "${TARGET_DIR}"

echo "Install workflow check passed."
