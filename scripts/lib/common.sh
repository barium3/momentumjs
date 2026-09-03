#!/bin/sh

if [ -z "${ROOT_DIR:-}" ]; then
  echo "Error: ROOT_DIR must be set before sourcing scripts/lib/common.sh." >&2
  exit 1
fi

APP_SUPPORT_USER_DIR="${MOMENTUM_APP_SUPPORT_USER_DIR:-${HOME}/Library/Application Support/Adobe}"
MOMENTUM_SUPPORT_DIR="${MOMENTUM_SUPPORT_DIR:-${HOME}/Library/Application Support/Momentum}"
MOMENTUM_UNINSTALL_DIR="${MOMENTUM_UNINSTALL_DIR:-${MOMENTUM_SUPPORT_DIR}/uninstall}"
DEFAULT_CEP_DEBUG_VERSIONS="6 7 8 9 10 11 12 13 14 15"

require_macos() {
  if [ "$(uname -s)" != "Darwin" ]; then
    echo "Error: This script currently supports macOS only." >&2
    exit 1
  fi
}

abs_dir() {
  if [ ! -d "$1" ]; then
    return 1
  fi
  (CDPATH= cd -- "$1" && pwd -P)
}

ensure_dir() {
  mkdir -p "$1"
}

require_non_root_install() {
  if [ "$(id -u)" = "0" ]; then
    echo "Error: Run Momentum's installer as the logged-in user, without sudo." >&2
    exit 1
  fi
}

enable_unsigned_cep_mode() {
  if [ "${MOMENTUM_ENABLE_CEP_DEBUG_MODE:-1}" = "0" ]; then
    echo "Unsigned CEP mode was not changed."
    return 0
  fi

  defaults_command="${MOMENTUM_DEFAULTS_COMMAND:-defaults}"
  if ! command -v "${defaults_command}" >/dev/null 2>&1; then
    echo "Error: Could not find the macOS 'defaults' command." >&2
    exit 1
  fi

  debug_versions="${MOMENTUM_CEP_DEBUG_VERSIONS:-${DEFAULT_CEP_DEBUG_VERSIONS}}"
  for version in ${debug_versions}; do
    case "${version}" in
      ''|*[!0-9]*)
        echo "Error: Invalid CEP major version: ${version}" >&2
        exit 1
        ;;
    esac
    "${defaults_command}" write "com.adobe.CSXS.${version}" PlayerDebugMode -string 1
  done

  echo "Unsigned CEP mode enabled for CSXS versions: ${debug_versions}"
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

  if [ -f "${ROOT_DIR}/extension/CSXS/manifest.xml" ]; then
    printf '%s\n' "${ROOT_DIR}/extension"
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
    "${ROOT_DIR}/native/macos/Momentum.plugin" \
    "${ROOT_DIR}/build-universal/Release/Momentum.plugin" \
    "${ROOT_DIR}/Momentum.plugin" \
    "${ROOT_DIR}/build/Momentum.plugin" \
    "${ROOT_DIR}/build/Debug/Momentum.plugin" \
    "${ROOT_DIR}/build-universal/Debug/Momentum.plugin" \
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

  common_plugins_dir="${APP_SUPPORT_USER_DIR}/Common/Plug-ins"
  if [ -d "${common_plugins_dir}" ]; then
    existing_dir="$(find "${common_plugins_dir}" -maxdepth 2 -type d -name MediaCore 2>/dev/null | sort | tail -n 1 || true)"
    if [ -n "${existing_dir}" ]; then
      printf '%s\n' "${existing_dir}"
      return 0
    fi
  fi

  printf '%s\n' "${APP_SUPPORT_USER_DIR}/Common/Plug-ins/7.0/MediaCore"
}

copy_runtime_extension_tree() {
  src_dir="$1"
  dest_dir="$2"

  ensure_dir "${dest_dir}"

  rsync -a --delete \
    --exclude '/user/' \
    --exclude '.git' \
    --exclude '.github' \
    --exclude '.DS_Store' \
    --exclude '.vscode' \
    --exclude '.idea' \
    --exclude '.local-user' \
    --exclude '.local-signing' \
    --exclude '.local-tools' \
    --exclude '.adobe-*' \
    --exclude '.ae2023-*' \
    --exclude 'build' \
    --exclude 'build-*' \
    --exclude 'dist' \
    --exclude 'docs' \
    --exclude 'scripts' \
    --exclude 'src' \
    --exclude 'CMakeLists.txt' \
    --exclude 'install.sh' \
    --exclude 'uninstall.sh' \
    --exclude 'Momentum.plugin' \
    --exclude 'README.md' \
    --exclude 'LICENSE' \
    --exclude 'footage/logoType.gif' \
    --exclude 'footage/showcase.png' \
    "${src_dir}/" \
    "${dest_dir}/"

  seed_user_examples "${src_dir}" "${dest_dir}"
}

seed_user_examples() {
  src_dir="$1"
  dest_dir="$2"
  source_examples_dir="${src_dir}/user/examples"
  target_user_dir="${dest_dir}/user"
  target_examples_dir="${target_user_dir}/examples"

  ensure_dir "${target_user_dir}"
  if [ ! -d "${source_examples_dir}" ]; then
    return 0
  fi

  ensure_dir "${target_examples_dir}"
  rsync -a --ignore-existing \
    "${source_examples_dir}/" \
    "${target_examples_dir}/"
}

remove_extension_preserving_user() {
  target_dir="$1"

  if [ ! -e "${target_dir}" ]; then
    return 0
  fi

  if [ "${MOMENTUM_REMOVE_USER_DATA:-0}" = "1" ] || [ ! -d "${target_dir}/user" ]; then
    rm -rf "${target_dir}"
    echo "Removed: ${target_dir}"
    return 0
  fi

  find "${target_dir}" \
    -mindepth 1 \
    -maxdepth 1 \
    ! -name user \
    -exec rm -rf {} \;
  echo "Removed Momentum application files: ${target_dir}"
  echo "Preserved user workspace: ${target_dir}/user"
}

copy_release_extension_tree() {
  src_dir="$1"
  dest_dir="$2"

  ensure_dir "${dest_dir}"

  rsync -a --delete \
    --exclude '.DS_Store' \
    --include 'CSXS/' \
    --include 'CSXS/***' \
    --include 'bundle/' \
    --include 'bundle/***' \
    --include 'footage/' \
    --include 'footage/new-alphabet-wide.ttf' \
    --include 'js/' \
    --include 'js/***' \
    --include 'jsx/' \
    --include 'jsx/***' \
    --include 'user/' \
    --include 'user/examples/' \
    --include 'user/examples/***' \
    --include 'index.html' \
    --include 'styles.css' \
    --exclude '*' \
    "${src_dir}/" \
    "${dest_dir}/"
}

copy_release_support_scripts() {
  dest_dir="$1"

  ensure_dir "${dest_dir}/scripts/lib"

  cp "${ROOT_DIR}/scripts/install.sh" "${dest_dir}/scripts/install.sh"
  cp "${ROOT_DIR}/scripts/uninstall.sh" "${dest_dir}/scripts/uninstall.sh"
  cp "${ROOT_DIR}/scripts/install-windows.ps1" "${dest_dir}/scripts/install-windows.ps1"
  cp "${ROOT_DIR}/scripts/uninstall-windows.ps1" "${dest_dir}/scripts/uninstall-windows.ps1"
  cp "${ROOT_DIR}/scripts/lib/common.sh" "${dest_dir}/scripts/lib/common.sh"
  cp "${ROOT_DIR}/install.command" "${dest_dir}/install.command"
  cp "${ROOT_DIR}/uninstall.command" "${dest_dir}/uninstall.command"
  cp "${ROOT_DIR}/install.cmd" "${dest_dir}/install.cmd"
  cp "${ROOT_DIR}/uninstall.cmd" "${dest_dir}/uninstall.cmd"

  chmod +x \
    "${dest_dir}/scripts/install.sh" \
    "${dest_dir}/scripts/uninstall.sh" \
    "${dest_dir}/install.command" \
    "${dest_dir}/uninstall.command"
}

install_macos_uninstaller() {
  dest_dir="${MOMENTUM_UNINSTALL_DIR}"

  ensure_dir "${dest_dir}/scripts/lib"
  cp "${ROOT_DIR}/uninstall.command" "${dest_dir}/uninstall.command"
  cp "${ROOT_DIR}/scripts/uninstall.sh" "${dest_dir}/scripts/uninstall.sh"
  cp "${ROOT_DIR}/scripts/lib/common.sh" "${dest_dir}/scripts/lib/common.sh"
  chmod +x "${dest_dir}/uninstall.command" "${dest_dir}/scripts/uninstall.sh"
}

copy_release_docs() {
  dest_dir="$1"

  cp "${ROOT_DIR}/README.md" "${dest_dir}/README.md"
  cp "${ROOT_DIR}/LICENSE" "${dest_dir}/LICENSE"
  ensure_dir "${dest_dir}/docs"
  rsync -a --delete --exclude '.DS_Store' \
    "${ROOT_DIR}/docs/" \
    "${dest_dir}/docs/"
}

remove_quarantine() {
  for target in "$@"; do
    if [ -n "${target}" ] && [ -e "${target}" ] && command -v xattr >/dev/null 2>&1; then
      xattr -dr com.apple.quarantine "${target}" >/dev/null 2>&1 || true
    fi
  done
}

create_zip_archive() {
  source_dir="$1"
  archive_path="$2"

  rm -f "${archive_path}"
  ensure_dir "$(dirname "${archive_path}")"

  parent_dir="$(dirname "${source_dir}")"
  base_name="$(basename "${source_dir}")"

  if command -v ditto >/dev/null 2>&1; then
    (
      CDPATH= cd -- "${parent_dir}" &&
      ditto -c -k --sequesterRsrc --keepParent "${base_name}" "${archive_path}"
    )
    return
  fi

  if command -v zip >/dev/null 2>&1; then
    (
      CDPATH= cd -- "${parent_dir}" &&
      zip -rq "${archive_path}" "${base_name}"
    )
    return
  fi

  echo "Error: Neither 'ditto' nor 'zip' is available to create an archive." >&2
  exit 1
}
