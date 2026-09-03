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
unset MOMENTUM_REMOVE_USER_DATA

FULL_SOURCE_DIR="${TEST_ROOT}/full-install/source"
FULL_PLUGIN_DIR="${TEST_ROOT}/full-install/Momentum.plugin"
FULL_APP_SUPPORT_DIR="${TEST_ROOT}/full-install/user/Adobe"
FULL_USER_TARGET_DIR="${FULL_APP_SUPPORT_DIR}/CEP/extensions/momentumjs"
FAKE_DEFAULTS="${TEST_ROOT}/full-install/defaults"
DEFAULTS_LOG="${TEST_ROOT}/full-install/defaults.log"

mkdir -p \
  "${FULL_SOURCE_DIR}/CSXS" \
  "${FULL_SOURCE_DIR}/user/examples" \
  "${FULL_PLUGIN_DIR}/Contents/MacOS"
printf '%s\n' '<manifest />' > "${FULL_SOURCE_DIR}/CSXS/manifest.xml"
printf '%s\n' 'full install payload' > "${FULL_SOURCE_DIR}/index.html"
printf '%s\n' 'bundled example' > "${FULL_SOURCE_DIR}/user/examples/example.js"
printf '%s\n' 'plugin binary' > "${FULL_PLUGIN_DIR}/Contents/MacOS/Momentum"
printf '%s\n' \
  '#!/bin/sh' \
  'printf "%s\\n" "$*" >> "${MOMENTUM_DEFAULTS_LOG}"' \
  > "${FAKE_DEFAULTS}"
chmod +x "${FAKE_DEFAULTS}"

MOMENTUM_APP_SUPPORT_USER_DIR="${FULL_APP_SUPPORT_DIR}" \
MOMENTUM_EXTENSION_SOURCE="${FULL_SOURCE_DIR}" \
MOMENTUM_PLUGIN_SOURCE="${FULL_PLUGIN_DIR}" \
MOMENTUM_DEFAULTS_COMMAND="${FAKE_DEFAULTS}" \
MOMENTUM_DEFAULTS_LOG="${DEFAULTS_LOG}" \
MOMENTUM_CEP_DEBUG_VERSIONS="11 12" \
sh "${ROOT_DIR}/scripts/install.sh"

test -f "${FULL_USER_TARGET_DIR}/index.html"
test -f "${FULL_USER_TARGET_DIR}/user/examples/example.js"
test -f "${FULL_APP_SUPPORT_DIR}/Common/Plug-ins/7.0/MediaCore/Momentum/Momentum.plugin/Contents/MacOS/Momentum"
test -d "${FULL_APP_SUPPORT_DIR}/Common/Plug-ins/7.0/MediaCore/Momentum/runtime"
test "$(sed -n '1p' "${DEFAULTS_LOG}")" = "write com.adobe.CSXS.11 PlayerDebugMode -string 1"
test "$(sed -n '2p' "${DEFAULTS_LOG}")" = "write com.adobe.CSXS.12 PlayerDebugMode -string 1"
test "$(wc -l < "${DEFAULTS_LOG}" | tr -d ' ')" = "2"

echo "Install workflow check passed."
