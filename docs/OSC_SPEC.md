# OSC Specification

`pro-djlink-manager` sends OSC over UDP.

Default public example target:

- host: `127.0.0.1`
- port: `29001`

## Addresses

### `/pro-dj-link/currentTrack`

Sent when the currently selected on-air track snapshot is refreshed.

Arguments:

1. `title`
2. `artist`
3. `layer`
4. `trackId`
5. `state`
6. `currentPositionMs`
7. `trackLengthMs`
8. `bpm`
9. `playbackRole`
10. `energy`
11. `atmosphereSummary`
12. `profileJson`

### `/pro-dj-link/trackChanged`

Sent once when the selected on-air track changes.

Arguments:

1. `title`
2. `artist`
3. `layer`
4. `trackId`
5. `state`
6. `currentPositionMs`
7. `trackLengthMs`
8. `bpm`
9. `playbackRole`
10. `energy`
11. `atmosphereSummary`
12. `isoTimestamp`
13. `epochSeconds`
14. `profileJson`

### `/pro-dj-link/trackProfile`

Sent when a full JSON profile is available.

Arguments:

1. `profileJson`

### `/pro-dj-link/test`

Manual connectivity check.

Arguments:

1. `"test"`
2. `host`
3. `port`
4. `isoTimestamp`

## Type notes

The implementation uses the Node.js `osc` package. Numeric JavaScript values are encoded as OSC float values.

## Sample profile

See:

- [sample-track-profile.json](../examples/touchdesigner/sample-track-profile.json)

## Suggested consumers

- TouchDesigner
- Max/MSP
- Unreal OSC bridge
- custom venue-control servers
