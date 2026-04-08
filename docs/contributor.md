# Contributor

This page is for contributors who want to build and run Momentum from source.

## Requirements

- Adobe After Effects installed on the machine
- After Effects SDK available locally
- a macOS environment for the current install scripts and plugin build flow

## First-Time Setup

1. Clone the repository.
2. Set `AE_SDK_ROOT` to your local After Effects SDK path.
3. Run:

```bash
bash scripts/install-dev.sh
```

This command:

1. builds `Momentum.plugin`
2. installs the CEP extension
3. installs the native plugin

After it finishes, restart After Effects.

## Daily Update

After pulling new source changes, run the same command again:

```bash
bash scripts/install-dev.sh
```

This is the normal contributor update flow.

## Build Only

If you only want to build the native plugin, run:

```bash
bash scripts/build-ae-plugin.sh
```

## Notes

- The current install scripts are macOS-only.
- Bitmap mode depends on `Momentum.plugin`; building the CEP panel alone is not enough.
- The release install flow in the main [README](../README.md) is for end users. This page is for local development.
