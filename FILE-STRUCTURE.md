# File Structure

> Public repository layout for `pro-djlink-manager`

## Overview

| Path | Role |
|---|---|
| `src/` | Node.js backend: Bridge ingest, selection engine, OSC output, GPT analysis |
| `public/` | Browser UI and WebGL visualizer |
| `data/emulator/` | Emulator seed state for dry runs |
| `docs/` | Public documentation, screenshots, optimized event photos |
| `examples/touchdesigner/` | OSC receiver example for TouchDesigner |
| `scripts/capture_dummy_screenshots.mjs` | Dummy-mode screenshot capture |

## Notes

- Vendor manuals and manual-derived text exports are intentionally excluded.
- Raw event photos are intentionally excluded; only optimized public images are included.
- Generated runtime caches such as `data/track-profiles/` are ignored.
- This repository is meant for GitHub publication and downstream reuse.
