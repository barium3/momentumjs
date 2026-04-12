#!/bin/sh

set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname "$0")" && pwd)"
ROOT_DIR="$(CDPATH= cd -- "${SCRIPT_DIR}/.." && pwd)"
export ROOT_DIR
. "${SCRIPT_DIR}/lib/common.sh"

require_macos

CEP_EXTENSIONS_DIR="$(cep_extensions_dir_for_scope "${MOMENTUM_CEP_SCOPE:-user}")"
CEP_TARGET_DIR="${CEP_EXTENSIONS_DIR}/momentumjs"

EXTENSION_SOURCE_DIR="$(resolve_extension_source || true)"
PLUGIN_SOURCE_DIR="$(resolve_plugin_source || true)"
MEDIA_CORE_DIR="$(resolve_media_core_dir)"
PLUGIN_CONTAINER_DIR="${MEDIA_CORE_DIR}/Momentum"
PLUGIN_TARGET_DIR="${PLUGIN_CONTAINER_DIR}/Momentum.plugin"
RUNTIME_TARGET_DIR="${PLUGIN_CONTAINER_DIR}/runtime"

if [ -z "${EXTENSION_SOURCE_DIR}" ]; then
  echo "Error: Could not find a Momentum CEP extension payload."
  echo "Expected CSXS/manifest.xml in the repo root or in ./momentumjs."
  exit 1
fi

if [ -z "${PLUGIN_SOURCE_DIR}" ]; then
  echo "Error: Could not find a prebuilt Momentum.plugin bundle."
  echo "Place Momentum.plugin next to the repo root, or build it into build/Debug first."
  exit 1
fi

ensure_dir "${CEP_EXTENSIONS_DIR}"
ensure_dir "${MEDIA_CORE_DIR}"
ensure_dir "${PLUGIN_CONTAINER_DIR}"
ensure_dir "${RUNTIME_TARGET_DIR}"

EXTENSION_SOURCE_ABS="$(abs_dir "${EXTENSION_SOURCE_DIR}")"
PLUGIN_SOURCE_ABS="$(abs_dir "${PLUGIN_SOURCE_DIR}")"
CEP_TARGET_ABS="$(abs_dir "${CEP_TARGET_DIR}" 2>/dev/null || true)"
PLUGIN_TARGET_ABS="$(abs_dir "${PLUGIN_TARGET_DIR}" 2>/dev/null || true)"

if [ "${EXTENSION_SOURCE_ABS}" != "${CEP_TARGET_ABS}" ]; then
  copy_runtime_extension_tree "${EXTENSION_SOURCE_DIR}" "${CEP_TARGET_DIR}"
fi

if [ "${PLUGIN_SOURCE_ABS}" != "${PLUGIN_TARGET_ABS}" ]; then
  rsync -a --delete "${PLUGIN_SOURCE_DIR}/" "${PLUGIN_TARGET_DIR}/"
fi

ensure_dir "${RUNTIME_TARGET_DIR}"
remove_quarantine "${CEP_TARGET_DIR}" "${PLUGIN_CONTAINER_DIR}"

echo "Momentum installed."
echo "CEP scope: ${MOMENTUM_CEP_SCOPE:-user}"
echo "CEP extension: ${CEP_TARGET_DIR}"
echo "Plugin bundle: ${PLUGIN_TARGET_DIR}"
echo "Runtime dir: ${RUNTIME_TARGET_DIR}"
echo "Restart After Effects before testing."
