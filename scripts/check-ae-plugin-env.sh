#!/bin/sh

set -eu

echo "Checking After Effects plugin build environment..."

if ! command -v xcodebuild >/dev/null 2>&1; then
  echo "ERROR: xcodebuild is not available. Install full Xcode and run xcode-select."
  exit 1
fi

if ! command -v cmake >/dev/null 2>&1; then
  echo "ERROR: cmake is not installed."
  exit 1
fi

if [ -z "${AE_SDK_ROOT:-}" ]; then
  echo "ERROR: AE_SDK_ROOT is not set."
  exit 1
fi

if [ ! -d "$AE_SDK_ROOT" ]; then
  echo "ERROR: AE_SDK_ROOT does not exist: $AE_SDK_ROOT"
  exit 1
fi

sdk_header_found=0
for header in AE_Effect.h AEConfig.h entry.h; do
  if find "$AE_SDK_ROOT" -name "$header" -print -quit | grep -q .; then
    :
  else
    echo "ERROR: Missing SDK header $header under $AE_SDK_ROOT"
    sdk_header_found=1
  fi
done

if [ "$sdk_header_found" -ne 0 ]; then
  exit 1
fi

echo "Environment looks ready for AE plugin bring-up."

