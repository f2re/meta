---
name: time-data-navigation
description: Design forecast/radar/satellite time navigation in Qt/C++: timelines, playback, model cycles, lead times, scrubbing, data resolution, accelerated stepping and request coalescing. Use when users move through temporal weather data or compare cycles.
---

# Time and Data Navigation

## Make time explicit

Always distinguish valid time, issue/cycle time and lead time. If more than one timezone matters, show the active timezone and make switching deliberate.

## Timeline behavior

- Click a tick/frame -> jump exactly to it.
- Drag/scrub -> preview rapidly using cached/nearest data, then fetch exact data after release/idle.
- Wheel over a dedicated timeline -> step time; wheel over the map remains spatial zoom.
- Arrow keys -> one frame/step; Page Up/Down -> larger step; Home/End -> first/latest available frame.
- Space -> play/pause when focus is not in text input.
- Playback preserves user-selected speed and loop mode.

## Adaptive stepping

Step size may adapt to the visible horizon but must be shown. Example: 5 min for nowcast, 1 h for short-range, 3 h for longer-range. Never silently skip data while presenting it as continuous.

Allow deliberate accelerated stepping:
- rapid repeated wheel/key input increases navigation velocity progressively;
- velocity decays quickly when input stops;
- display the current effective step (for example `+5 min`, `+30 min`, `+3 h`);
- cap acceleration and make direction reversal immediate.

## Model cycles

Switching cycle should preserve valid time when possible, not simply preserve lead time. If equivalent valid time is unavailable, choose nearest available and state the shift.

When a newer cycle arrives:
- indicate availability non-modally;
- do not steal the current analytical frame;
- allow one-click switch and one-click comparison with previous cycle.

## Data resolution

Spatial/temporal resolution is a data property, not just a zoom factor. When zoom/extent justifies a different dataset or aggregation level, request it after interaction settles and indicate the resolution transition if interpretation may change.

## Loading and race control

Debounce scrub/zoom requests, cancel obsolete requests, and reject late responses that no longer match the active view state. Keep the last valid frame visible while loading the next one whenever scientifically acceptable.