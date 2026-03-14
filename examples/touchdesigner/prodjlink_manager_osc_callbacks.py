import json

EVENT_LIMIT = 24


def _safe_op(name):
    try:
        return op(name)
    except Exception:
        return None


def _set_text(name, value):
    target = _safe_op(name)
    if target is None:
        return
    target.text = "" if value is None else str(value)


def _ensure_event_table():
    table = _safe_op("event_log")
    if table is None:
        return None
    if table.numRows == 0:
        table.appendRow(["time", "address", "message"])
    return table


def _append_event(address, message):
    table = _ensure_event_table()
    if table is None:
        return
    table.appendRow([f"{absTime.seconds:.2f}", address, message])
    while table.numRows > EVENT_LIMIT + 1:
        table.deleteRow(1)


def _reset_profile_table():
    table = _safe_op("track_profile_table")
    if table is None:
        return None
    table.clear()
    table.appendRow(["key", "value"])
    return table


def _flatten_profile(table, payload, prefix=""):
    if isinstance(payload, dict):
        for key in sorted(payload.keys()):
            next_prefix = f"{prefix}.{key}" if prefix else key
            _flatten_profile(table, payload[key], next_prefix)
        return

    if isinstance(payload, list):
        for index, value in enumerate(payload):
            next_prefix = f"{prefix}[{index}]"
            _flatten_profile(table, value, next_prefix)
        return

    table.appendRow([prefix, payload])


def _parse_json(raw):
    if raw in (None, ""):
        return None
    try:
        return json.loads(raw)
    except Exception:
        return None


def _update_from_current_track(args):
    if len(args) < 12:
        _append_event("/pro-dj-link/currentTrack", "payload too short")
        return

    title, artist, layer, track_id, state, position_ms, length_ms, bpm, role, energy, atmosphere, profile_json = args[:12]

    _set_text("track_title", title)
    _set_text("track_artist", artist)
    _set_text("track_state", f"L{int(layer)} {state}")
    _set_text("track_bpm", f"{float(bpm):.1f} BPM")
    _set_text("track_role", role)
    _set_text("track_energy", f"{float(energy):.0f}")
    _set_text("track_atmosphere", atmosphere)
    _set_text("track_json", profile_json)

    _append_event(
        "/pro-dj-link/currentTrack",
        f"{title} | {artist} | L{int(layer)} | {float(bpm):.1f} BPM | {int(position_ms)} / {int(length_ms)} ms",
    )

    profile = _parse_json(profile_json)
    if profile is not None:
        table = _reset_profile_table()
        if table is not None:
            _flatten_profile(table, profile)


def _update_from_profile(args):
    if not args:
        _append_event("/pro-dj-link/trackProfile", "empty payload")
        return

    profile_json = args[0]
    _set_text("track_json", profile_json)
    profile = _parse_json(profile_json)
    if profile is None:
        _append_event("/pro-dj-link/trackProfile", "invalid json")
        return

    table = _reset_profile_table()
    if table is not None:
        _flatten_profile(table, profile)

    title = (((profile or {}).get("track") or {}).get("title")) or "unknown"
    _append_event("/pro-dj-link/trackProfile", f"profile updated for {title}")


def _update_from_changed(args):
    if len(args) < 14:
        _append_event("/pro-dj-link/trackChanged", "payload too short")
        return

    title = args[0]
    artist = args[1]
    layer = args[2]
    changed_at = args[11]
    _append_event("/pro-dj-link/trackChanged", f"{title} | {artist} | L{int(layer)} | {changed_at}")


def onReceiveOSC(dat, rowIndex, message, bytes, timeStamp, address, args, peer):
    if address == "/pro-dj-link/currentTrack":
        _update_from_current_track(args)
        return

    if address == "/pro-dj-link/trackChanged":
        _update_from_changed(args)
        return

    if address == "/pro-dj-link/trackProfile":
        _update_from_profile(args)
        return

    if address == "/pro-dj-link/test":
        _append_event("/pro-dj-link/test", "test packet received")
        return

    _append_event(address, "unhandled address")
