# Installation, Paths, and Removal

This page is the source of truth for Momentum's platform status, installation
requirements, installed files, update behavior, and complete removal.

## Current Distribution Status

| Platform | Architecture | Currently validated with | Distribution status |
| --- | --- | --- | --- |
| macOS | Universal `x86_64` + `arm64`; deployment target macOS 11.0 | After Effects 2025 | Unsigned manual-install `.zip` |
| Windows | x64 | Windows 10 and After Effects 2022 | Unsigned manual-install `.zip` |

The CEP manifest accepts a wider range of After Effects versions. The table
above records configurations that have actually been validated; it is not a
guarantee that every host version accepted by the manifest has been tested.
Validate a release on its target After Effects version before publishing it.

Both platforms require the CEP panel and the native Momentum effect. Installing
only one of them is incomplete: the panel provides the editor and host bridge,
while `Momentum.plugin` or `Momentum.aex` provides Bitmap rendering.

## One Archive for Both Platforms

macOS and Windows use the same release asset:

- [Download the latest `momentumjs.zip`](https://github.com/barium3/momentumjs/releases/latest/download/momentumjs.zip)

The archive contains one shared CEP extension plus the native binary for each
platform:

```text
momentumjs/
  extension/              shared CEP panel
  native/macos/           Momentum.plugin
  native/windows/         Momentum.aex and runtime DLLs
  install.command         macOS entrypoint
  install.cmd             Windows entrypoint
  uninstall.command
  uninstall.cmd
```

## macOS Manual Installation

Unpack `momentumjs.zip`, open Terminal in the resulting `momentumjs` folder,
and run the macOS entrypoint as the logged-in user:

```bash
sh install.command
```

Do not use `sudo`. The script intentionally installs the unsigned CEP panel by
setting `PlayerDebugMode=1` for CSXS major versions 6 through 15. It then copies
both components under the current user's Library and removes macOS quarantine
attributes from the installed files. It does not install a second copy under
`/Library/Application Support/Adobe`.

Unsigned CEP mode allows other unsigned CEP extensions to run too. Install
Momentum only from a release or source tree that you trust. To target a smaller
set of CEP runtimes, override the default before running the script, for
example:

```bash
MOMENTUM_CEP_DEBUG_VERSIONS="12" sh install.command
```

Restart After Effects, then open `Window > Extensions > momentum.js`.

Contributors building from source should use the workflow in the
[Contributor Guide](contributor.md#first-time-setup).

## Windows Manual Installation

Unpack the same `momentumjs.zip`, close After Effects, and double-click
`install.cmd`. Accept the Windows UAC prompt so Momentum can install the native
effect under `C:\Program Files`.

The installer automatically:

- enables unsigned CEP mode for CSXS major versions 6 through 15
- installs the shared CEP panel under the current user's AppData directory
- installs `Momentum.aex` and packaged DLLs under Adobe's shared MediaCore path
- removes obsolete plug-in dependencies and the old plug-in-local runtime path
- creates the writable Bitmap runtime under `%LOCALAPPDATA%`
- preserves existing files in the CEP panel's `user\` workspace

Restart After Effects, then open `Window > Extensions > momentum.js`.

End users do not need the After Effects SDK, Visual Studio, CMake, vcpkg, or the
CUDA Toolkit. CUDA kernels are already embedded in `Momentum.aex`. At runtime,
CUDA uses the NVIDIA display driver's Driver API; OpenCL is used when After
Effects supplies an OpenCL context, and CPU is the fallback.

## Building from Source

Contributors producing the Windows binary need Visual Studio 2022, CMake,
vcpkg, the After Effects SDK, and a CUDA Toolkit that supplies `nvcc`. Configure
the environment and build the release artifact:

```powershell
$env:AE_SDK_ROOT = 'C:\path\to\AfterEffectsSDK'
$env:VCPKG_ROOT = 'C:\path\to\vcpkg'

cmake --preset windows-vs2022
cmake --build --preset windows-release
powershell -ExecutionPolicy Bypass -File scripts/package-windows-artifact.ps1
```

If macOS and Windows builds are produced on separate computers, copy the staged
`dist\windows\Release` directory into `dist/windows/Release` on the Mac that
assembles the unified archive. Then run:

```bash
bash scripts/package-release.sh
```

For complete source setup and test requirements, see the
[Contributor Guide](contributor.md).

## Default Installed Paths

| Component | macOS | Windows |
| --- | --- | --- |
| CEP panel | `~/Library/Application Support/Adobe/CEP/extensions/momentumjs` | `%APPDATA%\Adobe\CEP\extensions\momentumjs` |
| Native effect | `~/Library/Application Support/Adobe/Common/Plug-ins/<version>/MediaCore/Momentum/Momentum.plugin` | `C:\Program Files\Adobe\Common\Plug-ins\7.0\MediaCore\Momentum\Momentum.aex` |
| Native dependencies | Inside `Momentum.plugin` | Beside `Momentum.aex` in the same `Momentum` directory |
| Writable Bitmap runtime | `~/Library/Application Support/Adobe/Common/Plug-ins/<version>/MediaCore/Momentum/runtime` | `%LOCALAPPDATA%\Momentum\runtime` |
| User sketches and assets | CEP panel's `user/` directory | CEP panel's `user\` directory |

On macOS, `<version>` is the existing Adobe shared plug-in version selected by
the install script and is normally `7.0`. If none exists, the script creates the
`7.0/MediaCore` path. The source installers also support explicit path overrides
for development, so a custom installation may differ from the defaults above.

## Updates and User Files

The `user/` directory is the writable workspace for sketches and their local
assets. Both platform installers preserve existing files there during an update;
bundled examples are added only when the destination file does not already
exist.

Back up `user/` before manual removal or before moving an installation to
another computer. The installation process does not make arbitrary external
asset paths portable.

## macOS Removal

From an unpacked Momentum release or repository, run:

```bash
sh uninstall.command
```

This removes the Momentum application files and native plug-in but preserves
the CEP panel's `user/` workspace. To remove that workspace as well, run:

```bash
MOMENTUM_REMOVE_USER_DATA=1 sh scripts/uninstall.sh
```

The uninstaller removes only the current-user installation documented above.
It leaves `PlayerDebugMode` unchanged because that preference is shared by all
unsigned CEP extensions. To disable unsigned CEP mode after uninstalling every
unsigned extension, delete `PlayerDebugMode` for the versions that were enabled:

```bash
for version in 6 7 8 9 10 11 12 13 14 15; do
  defaults delete "com.adobe.CSXS.${version}" PlayerDebugMode 2>/dev/null || true
done
```

## Windows Removal

Close After Effects and double-click `uninstall.cmd`. It requests administrator
permission, removes the native effect and writable runtime, and preserves this
workspace by default:

```text
%APPDATA%\Adobe\CEP\extensions\momentumjs\user
```

To remove the workspace too, run this from the unpacked release directory:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/uninstall-windows.ps1 `
  -RemoveUserData -AutoElevate
```

If installation used custom `-CepDirectory`, `-PluginDirectory`, or
`-RuntimeDirectory` values,
remove those exact destinations instead.

The installer writes `PlayerDebugMode=1` under CSXS versions 6 through 15 in
`HKCU:\Software\Adobe`. That setting is shared with other unsigned CEP
extensions, so uninstall does not reset it automatically. Remove it only after
confirming that no other development panel still depends on it:

```powershell
foreach ($version in 6..15) {
  Remove-ItemProperty -Path "HKCU:\Software\Adobe\CSXS.$version" `
    -Name 'PlayerDebugMode' -ErrorAction SilentlyContinue
}
```
