# momentum.js

<p align="center">
  <img src="footage/logoType.gif" alt="logoType">
</p>

## Project Overview

`momentum.js` is an attempt to port the spirit of [Processing](https://processing.org/), [p5.js](https://p5js.org/), [openFrameworks](https://openframeworks.cc/), and [basil.js](https://basiljs2.netlify.app/) to Adobe After Effects. It aims to provide designers and developers with a powerful toolkit for procedural design and automation tasks within a user-friendly [WYSIWYG](https://en.wikipedia.org/wiki/WYSIWYG) interface in After Effects.

![showcase](footage/showcase.png)

## Documentation

Start here if you are new to Momentum:

- [Getting Started](docs/getting-started.md)

Browse the full API reference here:

- [API Reference](docs/api/index.md)

## Features

### For Processing and p5.js users

- Bring the spirit of Processing and p5.js into After Effects, pairing code-driven generative art with a user-friendly environment for creating offline-rendered generative art videos.
- Drive generative systems directly from the AE timeline, with controller interfaces that let you animate sketch variables through keyframes.

### For After Effects users

- Extend the native motion graphics workflow with a programmable system for building procedural and generative compositions inside AE, then integrate the results directly into conventional animation comps.
- Overcome the limits of AE's fragmented tool model by connecting logic across expressions, scripts, plugins, and layers without relying on brittle index-based setups.


## Install

Momentum requires Adobe After Effects. After Effects 2025 is recommended.

### macOS

Close After Effects, paste this block into Terminal, and then restart After
Effects when it finishes:

```bash
momentum_install_dir="$(mktemp -d)" && \
curl -fL https://github.com/barium3/momentumjs/releases/latest/download/momentumjs.zip \
  -o "$momentum_install_dir/momentumjs.zip" && \
ditto -x -k "$momentum_install_dir/momentumjs.zip" "$momentum_install_dir" && \
sh "$momentum_install_dir/momentumjs/install.command"
```

### Windows

Close After Effects, paste this block into PowerShell, and accept the Windows
administrator prompt:

```powershell
$ErrorActionPreference = 'Stop'
$momentumInstallDir = Join-Path `
  ([IO.Path]::GetTempPath()) `
  ('momentumjs-' + [guid]::NewGuid())
$momentumZip = Join-Path $momentumInstallDir 'momentumjs.zip'
New-Item -ItemType Directory -Path $momentumInstallDir | Out-Null
Invoke-WebRequest `
  -UseBasicParsing `
  -Uri 'https://github.com/barium3/momentumjs/releases/latest/download/momentumjs.zip' `
  -OutFile $momentumZip
Expand-Archive `
  -LiteralPath $momentumZip `
  -DestinationPath $momentumInstallDir
& (Join-Path $momentumInstallDir 'momentumjs\install.cmd')
```

## Uninstall

### macOS

Close After Effects and paste this block into Terminal:

```bash
sh "$HOME/Library/Application Support/Momentum/uninstall/uninstall.command"
```

### Windows

Close After Effects and paste this block into PowerShell:

```powershell
& "$env:LOCALAPPDATA\Momentum\uninstall\uninstall.cmd"
```

## Open in After Effects

- After installation, open the Momentum panel in After Effects from `Window > Extensions > momentum.js`
- Before using `Bitmap` mode, enable GPU acceleration in `File > Project Settings > Video Rendering and Effects > Use > Mercury GPU Acceleration`. This is the preparation step for Bitmap GPU rendering.

## Runtime Modes

Momentum currently has two runtime modes:

- `Vector`
  Sketch output is converted into native AE vector shapes, text objects, image layers, and controller layers.
- `Bitmap`
  Sketch output is rendered by the native `Momentum.plugin`/`Momentum.aex` effect, which unlocks a more complete API surface, platform GPU rendering where available, and larger renderable object counts.

Use `Vector` when you want AE-native vector graphics and text objects that remain easy to adjust after generation.

Use `Bitmap` when you need fuller rendering APIs such as `createGraphics()`, `loadPixels()`, `updatePixels()`, `filter()`, `blend()`, `loadFont()`, or `Font.textToPoints()`, and when you want the plugin's GPU-backed rendering path.

Bitmap mode uses Metal acceleration on macOS. On Windows it uses CUDA or
OpenCL when supplied by After Effects, with CPU fallback when GPU setup is not
available.

## Contribution

Contributors are welcome to submit issues, feature requests, and code improvements.

Please read our contribution guidelines for more information:

- [Contributor Guide](docs/contributor.md)

## License

This project is licensed under the MIT License. See [LICENSE](LICENSE) for details.
