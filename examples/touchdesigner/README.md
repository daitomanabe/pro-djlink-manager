# TouchDesigner OSC Receiver Example

This folder contains a minimal TouchDesigner-oriented example for receiving `pro-djlink-manager` OSC messages.

## Included files

- `prodjlink_manager_osc_callbacks.py`
- `sample-track-profile.json`

## Suggested operator setup

Create the following operators in TouchDesigner:

1. `oscin1` as `OSC In DAT`
2. `track_title` as `Text DAT`
3. `track_artist` as `Text DAT`
4. `track_state` as `Text DAT`
5. `track_bpm` as `Text DAT`
6. `track_role` as `Text DAT`
7. `track_energy` as `Text DAT`
8. `track_atmosphere` as `Text DAT`
9. `track_json` as `Text DAT`
10. `track_profile_table` as `Table DAT`
11. `event_log` as `Table DAT`

## OSC In DAT settings

- Port: `29001`
- Active: `On`
- Callbacks DAT: point to `prodjlink_manager_osc_callbacks.py`

## What the callback does

- Updates text DATs from `/pro-dj-link/currentTrack`
- Writes the latest profile JSON to `track_json`
- Parses `/pro-dj-link/trackProfile` and flattens key fields into `track_profile_table`
- Appends incoming messages to `event_log`

## Notes

- The script is defensive. Missing operators are ignored.
- The callback is meant as a starting point, not a finished TouchDesigner project file.
- Use `sample-track-profile.json` for table design and parser testing before connecting live OSC.
