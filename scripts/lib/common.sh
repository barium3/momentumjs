#!/bin/sh

if [ -z "${ROOT_DIR:-}" ]; then
  echo "Error: ROOT_DIR must be set before sourcing scripts/lib/common.sh." >&2
  exit 1
fi

APP_SUPPORT_USER_DIR="${HOME}/Library/Application Support/Adobe"
SYSTEM_CEP_EXTENSIONS_DIR="/Library/Application Support/Adobe/CEP/extensions"

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

load_local_signing_env() {
  env_file="${ROOT_DIR}/.local-signing/zxp.env"

  if [ -f "${env_file}" ]; then
    . "${env_file}"
  fi
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
    "${ROOT_DIR}/build-universal/Debug/Momentum.plugin" \
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

cep_extensions_dir_for_scope() {
  scope="${1:-user}"

  case "${scope}" in
    user)
      printf '%s\n' "${APP_SUPPORT_USER_DIR}/CEP/extensions"
      ;;
    system)
      printf '%s\n' "${SYSTEM_CEP_EXTENSIONS_DIR}"
      ;;
    *)
      echo "Error: Unsupported MOMENTUM_CEP_SCOPE='${scope}'. Use 'user' or 'system'." >&2
      exit 1
      ;;
  esac
}

copy_runtime_extension_tree() {
  src_dir="$1"
  dest_dir="$2"

  ensure_dir "${dest_dir}"

  rsync -a --delete \
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

copy_zxp_extension_tree() {
  src_dir="$1"
  dest_dir="$2"

  copy_release_extension_tree "${src_dir}" "${dest_dir}"
}

copy_release_support_scripts() {
  dest_dir="$1"

  ensure_dir "${dest_dir}/scripts/lib"

  cp "${ROOT_DIR}/scripts/install.sh" "${dest_dir}/scripts/install.sh"
  cp "${ROOT_DIR}/scripts/uninstall.sh" "${dest_dir}/scripts/uninstall.sh"
  cp "${ROOT_DIR}/scripts/lib/common.sh" "${dest_dir}/scripts/lib/common.sh"

  chmod +x \
    "${dest_dir}/scripts/install.sh" \
    "${dest_dir}/scripts/uninstall.sh"
}

copy_release_docs() {
  dest_dir="$1"

  cp "${ROOT_DIR}/README.md" "${dest_dir}/README.md"
  cp "${ROOT_DIR}/LICENSE" "${dest_dir}/LICENSE"
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

find_zxp_sign_cmd() {
  for candidate in \
    "${ROOT_DIR}/.local-tools/ZXPSignCmd/ZXPSignCmd" \
    "${ROOT_DIR}/.local-tools/ZXPSignCMD/ZXPSignCmd" \
    "${ROOT_DIR}/.local-tools/ZXPSignCMD/4.1.3/macOS/ZXPSignCmd"
  do
    if [ -x "${candidate}" ]; then
      printf '%s\n' "${candidate}"
      return 0
    fi
  done

  if [ -n "${MOMENTUM_ZXP_SIGN_CMD:-}" ]; then
    if [ -x "${MOMENTUM_ZXP_SIGN_CMD}" ]; then
      printf '%s\n' "${MOMENTUM_ZXP_SIGN_CMD}"
      return 0
    fi
    if command -v "${MOMENTUM_ZXP_SIGN_CMD}" >/dev/null 2>&1; then
      command -v "${MOMENTUM_ZXP_SIGN_CMD}"
      return 0
    fi
  fi

  if command -v ZXPSignCmd >/dev/null 2>&1; then
    command -v ZXPSignCmd
    return 0
  fi

  if command -v ZXPSignCMD >/dev/null 2>&1; then
    command -v ZXPSignCMD
    return 0
  fi

  return 1
}
