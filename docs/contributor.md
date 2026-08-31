# Contributor

This page is for contributors who want to build and run Momentum from source.

## Requirements

- Adobe After Effects installed on the machine
- After Effects SDK available locally
- macOS with Xcode, or Windows x64 with Visual Studio 2022 Build Tools, CMake,
  and vcpkg

## First-Time Setup

1. Clone the repository.
2. Set `AE_SDK_ROOT` to your local After Effects SDK path.
3. Build and install for your platform.

### macOS

```bash
bash scripts/install-dev.sh
```

This command:

1. builds `Momentum.plugin`
2. installs the CEP extension
3. installs the native plugin

After it finishes, restart After Effects.

### Windows

Set `AE_SDK_ROOT` to the extracted SDK and `VCPKG_ROOT` to your vcpkg
installation, then run:

```powershell
cmake --preset windows-vs2022
cmake --build --preset windows-debug
ctest --preset windows-debug
cmake --build --preset windows-release
powershell -ExecutionPolicy Bypass -File scripts/install-windows.ps1 `
  -Configuration Release -EnableCepDebugMode -CepMajorVersion 11
```

The final switch enables the unsigned development panel for AE 2022/CEP 11.
Omit `-EnableCepDebugMode` when installing a signed CEP package.

## Daily Update

After pulling new source changes on macOS, run the same command again:

```bash
bash scripts/install-dev.sh
```

This is the normal contributor update flow.

On Windows, rebuild the `windows-release` preset and rerun
`scripts/install-windows.ps1`. Close After Effects before installing.

## Build Only

If you only want to build the native plugin, run:

```bash
bash scripts/build-ae-plugin.sh
```

On Windows:

```powershell
cmake --build --preset windows-release
```

## Packaging

Maintainers can assemble the macOS runtime bundle with:

```bash
bash scripts/package-release.sh
```

Creates `dist/momentumjs.zip`, a clean macOS runtime bundle with:

1. the CEP payload at the archive root
2. `Momentum.plugin`
3. install and uninstall helpers

To build the one-step macOS installer package that installs both the signed CEP panel and `Momentum.plugin`, run:

```bash
bash scripts/package-installer.sh
```

This creates `dist/momentumjs-installer.pkg`. It expects `dist/momentumjs.zxp` to already exist.

## Script Layout

The repository now uses `scripts/` as the single CLI entrypoint layer:

- `scripts/install.sh` and `scripts/uninstall.sh` hold the real macOS install logic.
- `scripts/install-dev.sh` is the contributor shortcut that builds `Momentum.plugin` and then runs the source install flow.
- `scripts/install-windows.ps1` installs `Momentum.aex`, its runtime DLLs, and
  the CEP panel while preserving the Windows `user` workspace.
- `scripts/package-release.sh` assembles the macOS release zip with the CEP payload, `Momentum.plugin`, and install helpers.
- `scripts/package-installer.sh` assembles a macOS `.pkg` installer for the signed panel and native plugin.
- `scripts/lib/common.sh` is the shared path and packaging helper layer used by the install and packaging scripts.

## Notes

- Bitmap mode depends on `Momentum.plugin` on macOS or `Momentum.aex` on
  Windows; building the CEP panel alone is not enough.
- The Windows bitmap renderer currently uses the CPU path; Metal acceleration
  remains macOS-only.
- The release install flow in the main [README](../README.md) is for end users. This page is for local development.
