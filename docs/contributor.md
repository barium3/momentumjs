# Contributor

This page is for contributors who want to build and run Momentum from source.

## Requirements

- Adobe After Effects installed on the machine
- After Effects SDK available locally
- macOS with Xcode, or Windows x64 with Visual Studio 2022 Build Tools, CMake,
  vcpkg, and a CUDA Toolkit that supplies `nvcc`

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
  -Configuration Release
```

Run the final command from an elevated PowerShell session. It enables unsigned
CEP mode for CSXS versions 6 through 15 by default; pass `-SkipCepDebugMode`
only when the required preference has already been configured.
Windows runtime transports are written under
`%LOCALAPPDATA%\Momentum\runtime`, outside the protected plugin directory.

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

For a distributable macOS Universal Release build, bootstrap vcpkg once and
run:

```bash
git clone https://github.com/microsoft/vcpkg.git .local-tools/vcpkg
sh .local-tools/vcpkg/bootstrap-vcpkg.sh -disableMetrics
bash scripts/build-macos-universal.sh
```

Set `VCPKG_ROOT` only when using a vcpkg checkout outside the default
`.local-tools/vcpkg` path.

This cross-builds both `x86_64` and `arm64` with static text dependencies,
runs tests for the host architecture, and creates
`build-universal/Release/Momentum.plugin`. An ARM Mac is only required for the
final ARM runtime check, not for compilation.

On Windows, build and stage the release artifact:

```powershell
cmake --build --preset windows-release
powershell -ExecutionPolicy Bypass -File scripts/package-windows-artifact.ps1
```

## Packaging

`momentumjs.zip` is one cross-platform release asset. Before assembling it,
place the staged Windows directory at `dist/windows/Release` and build the
macOS Universal plug-in. Then run on macOS:

```bash
bash scripts/package-release.sh
```

Creates `dist/momentumjs.zip` with:

1. the shared CEP payload under `extension/`
2. `native/macos/Momentum.plugin`
3. `native/windows/Momentum.aex` and any runtime DLLs
4. macOS and Windows install/uninstall entrypoints
5. end-user and API documentation

This `.zip` is the only release format for both platforms. The install helpers
enable unsigned CEP mode on the destination machine, so release packaging does
not require a ZXP certificate, `ZXPSignCmd`, or platform installer package.

## Script Layout

The repository now uses `scripts/` as the single CLI entrypoint layer:

- `scripts/install.sh` and `scripts/uninstall.sh` hold the real macOS install logic.
- `scripts/install-dev.sh` is the contributor shortcut that builds `Momentum.plugin` and then runs the source install flow.
- `scripts/install-windows.ps1` installs `Momentum.aex`, its runtime DLLs, and
  the CEP panel while preserving the Windows `user` workspace.
- `scripts/uninstall-windows.ps1` removes the Windows native/runtime files and
  preserves the `user` workspace unless explicitly requested otherwise.
- `scripts/package-windows-artifact.ps1` stages the Windows release binary for
  transfer to the machine assembling the unified archive.
- `scripts/package-release.sh` assembles the single cross-platform release zip.
- `install.command`/`uninstall.command` and `install.cmd`/`uninstall.cmd` are
  the end-user entrypoints included at the archive root.
- `scripts/lib/common.sh` is the shared path and packaging helper layer used by the install and packaging scripts.

On macOS, keep the source repository outside Adobe's CEP discovery directories.
The install script owns the canonical runtime copy at
`~/Library/Application Support/Adobe/CEP/extensions/momentumjs`. The native
plug-in and writable transport files remain under the user's Adobe
`Common/Plug-ins` tree.

## CEP And Host Startup Contract

- `CSXS/manifest.xml` owns the CEP HTML entrypoint only. Do not add a JSX
  `ScriptPath`; `js/plugin/bridge.js` is the single owner of loading
  `jsx/main.jsx`.
- `jsx/plugin/hostSession.jsx` owns the versioned handshake and reports the
  canonical extension, user, and runtime roots. Host calls should go through
  `momentumPluginBridge.evaluateHostScript()` so they wait for readiness and
  participate in reconnect handling.
- `js/ui/console/errorProtocol.js` owns structured errors crossing CEP,
  ExtendScript, and native-runtime boundaries. Preserve `code`, `stage`,
  `path`, and `retryable` when adding a new producer.
- `js/ui/editor/bitmapControllerBootstrap.js` discovers controllers in a
  no-I/O sandbox. Asset loaders in this pass must return deterministic
  placeholders; real asset loading belongs to the execution/analyzer pass.

## Notes

- Bitmap mode depends on `Momentum.plugin` on macOS or `Momentum.aex` on
  Windows; building the CEP panel alone is not enough.
- The Windows bitmap renderer accepts the framework supplied by After Effects:
  CUDA on compatible NVIDIA devices and OpenCL when AE supplies an OpenCL
  context, with CPU fallback. Metal remains the macOS GPU backend.
- The release install flow in the main [README](../README.md) is for end users. This page is for local development.
