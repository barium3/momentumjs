#!/bin/sh

set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname "$0")" && pwd)"
ROOT_DIR="$(CDPATH= cd -- "${SCRIPT_DIR}/.." && pwd)"

if [ "$(uname -s)" != "Darwin" ]; then
  echo "Error: scripts/install.sh currently supports macOS only."
  exit 1
fi

APP_SUPPORT_DIR="${HOME}/Library/Application Support/Adobe"
CEP_EXTENSIONS_DIR="${APP_SUPPORT_DIR}/CEP/extensions"
CEP_TARGET_DIR="${CEP_EXTENSIONS_DIR}/momentumjs"

abs_dir() {
  if [ ! -d "$1" ]; then
    return 1
  fi
  (CDPATH= cd -- "$1" && pwd -P)
}

resolve_extension_source() {
  if [ -n "${MOMENTUM_EXTENSION_SOURCE:-}" ] && [ -f "${MOMENTUM_EXTENSION_SOURCE}/CSXS/manifest.xml" ]; then
    printf '%s\n' "${MOMENTUM_EXTENSION_SOURCE}"
    return 0
  fi
  if [ -f "${ROOT_DIR}/CSXS/manifest.xml" ]; then
    printf '%s\n' "${ROOT_DIR}"
    return 0
  fi
  if [ -f "${ROOT_DIR}/momentumjs/CSXS/manifest.xml" ]; then
    printf '%s\n' "${ROOT_DIR}/momentumjs"
    return 0
  fi
  return 1
}

resolve_plugin_source() {
  if [ -n "${MOMENTUM_PLUGIN_SOURCE:-}" ] && [ -d "${MOMENTUM_PLUGIN_SOURCE}/Contents/MacOS" ]; then
    printf '%s\n' "${MOMENTUM_PLUGIN_SOURCE}"
    return 0
  fi

  for candidate in \
    "${ROOT_DIR}/Momentum.plugin" \
    "${ROOT_DIR}/build/Debug/Momentum.plugin" \
    "${ROOT_DIR}/dist/Momentum.plugin"
  do
    if [ -d "${candidate}/Contents/MacOS" ]; then
      printf '%s\n' "${candidate}"
      return 0
    fi
  done
  return 1
}

resolve_media_core_dir() {
  if [ -n "${MOMENTUM_MEDIA_CORE_DIR:-}" ]; then
    printf '%s\n' "${MOMENTUM_MEDIA_CORE_DIR}"
    return 0
  fi

  common_plugins_dir="${APP_SUPPORT_DIR}/Common/Plug-ins"
  if [ -d "${common_plugins_dir}" ]; then
    existing_dir="$(find "${common_plugins_dir}" -maxdepth 2 -type d -name MediaCore 2>/dev/null | sort | tail -n 1 || true)"
    if [ -n "${existing_dir}" ]; then
      printf '%s\n' "${existing_dir}"
      return 0
    fi
  fi

  printf '%s\n' "${APP_SUPPORT_DIR}/Common/Plug-ins/7.0/MediaCore"
}

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

mkdir -p "${CEP_EXTENSIONS_DIR}"
mkdir -p "${MEDIA_CORE_DIR}"
mkdir -p "${PLUGIN_CONTAINER_DIR}"
mkdir -p "${RUNTIME_TARGET_DIR}"

EXTENSION_SOURCE_ABS="$(abs_dir "${EXTENSION_SOURCE_DIR}")"
PLUGIN_SOURCE_ABS="$(abs_dir "${PLUGIN_SOURCE_DIR}")"
CEP_TARGET_ABS="$(abs_dir "${CEP_TARGET_DIR}" 2>/dev/null || true)"
PLUGIN_TARGET_ABS="$(abs_dir "${PLUGIN_TARGET_DIR}" 2>/dev/null || true)"

if [ "${EXTENSION_SOURCE_ABS}" != "${CEP_TARGET_ABS}" ]; then
  rsync -a --delete \
    --exclude '.git' \
    --exclude 'build' \
    --exclude '.DS_Store' \
    "${EXTENSION_SOURCE_DIR}/" \
    "${CEP_TARGET_DIR}/"
fi

if [ "${PLUGIN_SOURCE_ABS}" != "${PLUGIN_TARGET_ABS}" ]; then
  rsync -a --delete "${PLUGIN_SOURCE_DIR}/" "${PLUGIN_TARGET_DIR}/"
fi

mkdir -p "${RUNTIME_TARGET_DIR}"

if command -v xattr >/dev/null 2>&1; then
  xattr -dr com.apple.quarantine "${CEP_TARGET_DIR}" >/dev/null 2>&1 || true
  xattr -dr com.apple.quarantine "${PLUGIN_CONTAINER_DIR}" >/dev/null 2>&1 || true
fi

echo "Momentum installed."
echo "CEP extension: ${CEP_TARGET_DIR}"
echo "Plugin bundle: ${PLUGIN_TARGET_DIR}"
echo "Runtime dir: ${RUNTIME_TARGET_DIR}"
echo "Restart After Effects before testing."
