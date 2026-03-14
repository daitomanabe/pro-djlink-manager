# Dummy Mode

Dummy mode exists for manuals, demos, UI review, and OSC integration without live `Pro DJ Link Bridge` hardware.

## Start

```bash
PORT=3000 DUMMY_MODE=true npm start
```

If the server is already running, enable dummy mode through the API:

```bash
curl -X POST http://localhost:3000/api/dummy/start
```

Stop:

```bash
curl -X POST http://localhost:3000/api/dummy/stop
```

## Capture screenshots

```bash
npm run capture:dummy
```

Output directory:

- `docs/assets/screenshots/`

## Included assets

The public repository already contains a captured set:

- `docs/assets/screenshots/dummy-on-air.png`
- `docs/assets/screenshots/dummy-input-monitor.png`
- `docs/assets/screenshots/dummy-visualizer.png`

## Notes

- The dummy tracks use `Daito Manabe` as artist and synthetic titles.
- The dummy payload includes deterministic playback data plus synthetic atmosphere analysis.
- Screenshot capture uses Chrome DevTools Protocol and expects local Chrome to be available.
